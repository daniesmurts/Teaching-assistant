import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireInstitutionAdmin } from '../middleware/requireRole'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  createProgramRules, updateProgramRules, replaceDisciplinesRules, replaceCompetenciesRules,
} from '../validation/programValidation'
import {
  listPrograms, createProgram, findProgram, getProgramDetail, updateProgram, deleteProgram,
  replaceDisciplines, replaceCompetencies, saveAnalysis, getLatestAnalysis,
} from '../db/queries/programs'
import { analyzeProgram } from '../services/programAnalysis'
import { generateProgramReportPdf } from '../services/programReportPdf'
import { uploadFields } from '../middleware/fileValidation'
import { extractText } from '../services/documentExtractor'
import { parseStudyPlan, parseDescription } from '../services/programImport'
import { setProgramDocs } from '../db/queries/programs'
import { logger } from '../lib/logger'
import type { ProgramDiscipline, ProgramCompetency } from '../../../shared/types'

// Academic programs (учебные планы) — institution-admin only. Every handler is
// scoped to the admin's own institution; the institution_id is derived from the
// authenticated teacher, never from the request body.
const router = Router()
router.use(authenticate)
router.use(requireInstitutionAdmin)

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// ── Programs CRUD ───────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  res.json(await listPrograms(institutionId(req)))
}))

router.post('/', validate(createProgramRules), asyncHandler(async (req, res) => {
  const program = await createProgram(institutionId(req), req.teacher.id, req.body)
  res.status(201).json(program)
}))

// POST /import — intake form: metadata text fields + two PDFs (описание ОП,
// учебный план). Extracts both, parses учебный план → disciplines and описание →
// competencies/goals, creates the program pre-populated and ready to analyse.
router.post(
  '/import',
  aiLimiter,
  uploadFields([{ name: 'description', maxCount: 1 }, { name: 'plan', maxCount: 1 }]),
  asyncHandler(async (req, res) => {
    const inst = institutionId(req)
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const planFile = files?.plan?.[0]
    const descFile = files?.description?.[0]

    if (!planFile) throw new ValidationError('Загрузите файл учебного плана (PDF).')

    const name = String(req.body.name ?? req.body.specialty_name ?? '').trim()
    if (name.length < 2) throw new ValidationError('Укажите наименование программы.')

    const teacherId = req.teacher.id
    const institutionIdOpt = req.teacher.institution_id ?? undefined
    const warnings: string[] = []

    // 1) Extract text — never let a single document failure abort the import.
    let planText: string | null = null
    try {
      planText = (await extractText(planFile.buffer, planFile.mimetype)).text
    } catch (err) {
      logger.warn({ message: 'Program import: plan extraction failed', error: (err as Error).message })
      warnings.push('Не удалось извлечь текст из учебного плана — добавьте дисциплины вручную.')
    }

    let descText: string | null = null
    if (descFile) {
      try {
        descText = (await extractText(descFile.buffer, descFile.mimetype)).text
      } catch (err) {
        logger.warn({ message: 'Program import: description extraction failed', error: (err as Error).message })
        warnings.push('Не удалось извлечь текст из описания ОП — добавьте компетенции вручную.')
      }
    }

    // 2) Parse — each pass degrades independently.
    let disciplines: ProgramDiscipline[] = []
    if (planText) {
      try {
        disciplines = await parseStudyPlan({ teacherId, institutionId: institutionIdOpt, planText })
      } catch (err) {
        logger.warn({ message: 'Program import: plan parse failed', error: (err as Error).message })
        warnings.push('Не удалось разобрать учебный план автоматически.')
      }
    }
    if (planText && disciplines.length === 0 && !warnings.some((w) => w.includes('учебн'))) {
      warnings.push('Дисциплины не распознаны в учебном плане — проверьте файл или добавьте вручную.')
    }

    let competencies: ProgramCompetency[] = []
    if (descText) {
      try {
        competencies = await parseDescription({ teacherId, descriptionText: descText })
      } catch (err) {
        logger.warn({ message: 'Program import: description parse failed', error: (err as Error).message })
        warnings.push('Не удалось разобрать описание ОП автоматически.')
      }
    }

    const duration = Math.max(8, ...disciplines.map((d) => d.semester), 1)

    // 3) Always create + populate with whatever we got — the admin edits the rest.
    const program = await createProgram(inst, teacherId, {
      name,
      code:               req.body.code || null,
      duration_semesters: duration,
      specialty_name:     req.body.specialty_name || null,
      education_level:    req.body.education_level || null,
      profile:            req.body.profile || null,
      forms_of_study:     req.body.forms_of_study || null,
    })

    await setProgramDocs(program.id, { description_text: descText, plan_text: planText })
    if (competencies.length > 0) await replaceCompetencies(program.id, competencies)
    if (disciplines.length > 0)  await replaceDisciplines(program.id, disciplines)

    res.status(201).json({
      program,
      imported: { disciplines: disciplines.length, competencies: competencies.length },
      warnings,
    })
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const detail = await getProgramDetail(req.params.id, institutionId(req))
  if (!detail) throw new NotFoundError('Учебный план')
  res.json(detail)
}))

router.patch('/:id', validate(updateProgramRules), asyncHandler(async (req, res) => {
  const program = await updateProgram(req.params.id, institutionId(req), req.body)
  if (!program) throw new NotFoundError('Учебный план')
  res.json(program)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteProgram(req.params.id, institutionId(req))
  if (!ok) throw new NotFoundError('Учебный план')
  res.status(204).end()
}))

// ── Bulk content replaces ─────────────────────────────────────────────────────

router.put('/:id/disciplines', validate(replaceDisciplinesRules), asyncHandler(async (req, res) => {
  const program = await findProgram(req.params.id, institutionId(req))
  if (!program) throw new NotFoundError('Учебный план')

  const disciplines: ProgramDiscipline[] = (req.body.disciplines as ProgramDiscipline[]).map((d, i) => ({
    course_id:        d.course_id ?? null,
    name:             d.name,
    semester:         d.semester,
    credits:          d.credits ?? null,
    control_form:     d.control_form ?? null,
    competency_codes: Array.isArray(d.competency_codes) ? d.competency_codes : [],
    sort_order:       d.sort_order ?? i,
  }))
  await replaceDisciplines(program.id, disciplines)
  res.json(await getProgramDetail(program.id, institutionId(req)))
}))

router.put('/:id/competencies', validate(replaceCompetenciesRules), asyncHandler(async (req, res) => {
  const program = await findProgram(req.params.id, institutionId(req))
  if (!program) throw new NotFoundError('Учебный план')

  const competencies: ProgramCompetency[] = (req.body.competencies as ProgramCompetency[]).map((c, i) => ({
    kind:       c.kind === 'goal' ? 'goal' : 'competency',
    code:       c.code ?? null,
    title:      c.title,
    sort_order: c.sort_order ?? i,
  }))
  await replaceCompetencies(program.id, competencies)
  res.json(await getProgramDetail(program.id, institutionId(req)))
}))

// ── Analysis ────────────────────────────────────────────────────────────────────

router.post('/:id/analyze', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await getProgramDetail(req.params.id, institutionId(req))
  if (!detail) throw new NotFoundError('Учебный план')

  const analysis = await analyzeProgram({
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
    program:       detail,
  })
  await saveAnalysis(detail.id, analysis)
  res.json(analysis)
}))

router.get('/:id/analysis', asyncHandler(async (req, res) => {
  const program = await findProgram(req.params.id, institutionId(req))
  if (!program) throw new NotFoundError('Учебный план')
  res.json(await getLatestAnalysis(program.id))
}))

// GET /:id/analysis.pdf — server-rendered premium PDF of the latest analysis.
router.get('/:id/analysis.pdf', asyncHandler(async (req, res) => {
  const detail = await getProgramDetail(req.params.id, institutionId(req))
  if (!detail) throw new NotFoundError('Учебный план')
  const analysis = await getLatestAnalysis(detail.id)
  if (!analysis) throw new ValidationError('Сначала запустите анализ программы.')

  const pdf = await generateProgramReportPdf(detail, analysis)
  const fname = `analysis-${(detail.code || 'program').replace(/[^\w.-]/g, '_')}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
  res.setHeader('Content-Length', pdf.length)
  res.end(pdf)
}))

export default router
