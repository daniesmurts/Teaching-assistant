import { Router, Request } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireProgramAccess } from '../middleware/requireProgramAccess'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError, ForbiddenError } from '../errors/AppError'
import {
  createProgramRules, updateProgramRules, replaceDisciplinesRules, replaceCompetenciesRules,
} from '../validation/programValidation'
import {
  listPrograms, listProgramsForUnits, createProgram, findProgram, getProgramDetail, updateProgram, deleteProgram,
  replaceDisciplines, replaceCompetencies, saveAnalysis, getLatestAnalysis,
  listProgramUnitsForInstitution, listProgramUnitsByIds,
  fillDisciplineCompetencyCodesIfEmpty,
} from '../db/queries/programs'
import { canEditProgram, canReadProgram } from '../services/programAccess'
import { listAncestorsOfUnit } from '../db/queries/orgUnits'
import { analyzeProgram } from '../services/programAnalysis'
import { reviewDocumentCoverage, detectDeclaredCompetencyCodes } from '../services/documentReview'
import { generateProgramReportPdf } from '../services/programReportPdf'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { extractText } from '../services/documentExtractor'
import { parseStudyPlan, parseDescription, parseCompetencyMatrix } from '../services/programImport'
import { setProgramDocs, setReportedSemesterTotals } from '../db/queries/programs'
import { uploadObject, downloadObject, deleteObject } from '../services/objectStorage'
import {
  insertProgramDocument, listProgramDocuments, findProgramDocument, deleteProgramDocument,
  findWorkingProgrammeForDiscipline, deleteWorkingProgrammeForDiscipline, deletePracticeForType,
} from '../db/queries/programDocuments'
import { insertReview, getLatestReviewByDiscipline, getLatestReviewForDiscipline } from '../db/queries/programDocumentReviews'
import { logger } from '../lib/logger'
import type {
  ProgramDiscipline, ProgramCompetency,
  ProgramPracticeType, ProgramDocumentKind,
} from '../../../shared/types'
import { PROGRAM_PRACTICE_TYPES } from '../../../shared/types'

// Filename sanitisation for object-storage keys — cognate of the helper in
// services/documents.ts. Keeps the extension intact.
function sanitiseName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 120)
}

function documentStoragePath(programId: string, docId: string, fileName: string): string {
  return `programs/${programId}/${docId}_${sanitiseName(fileName)}`
}

// Uploads a single file to object storage and inserts a program_documents
// row. Returns the created row's id. Failures leave nothing behind — we
// upload first, insert second; a failed insert means an orphaned object,
// which we log and best-effort clean.
async function attachProgramDocument(params: {
  programId:     string
  kind:          ProgramDocumentKind
  practiceType:  ProgramPracticeType | null
  disciplineId?: string | null
  extractedText?: string | null
  file:          Express.Multer.File
  uploadedBy:    string
}): Promise<string> {
  // Pre-generate an id so the storage key can include it before the row exists.
  // Any UUID works; the DB regenerates its own default anyway.
  const tempId = (globalThis.crypto as Crypto).randomUUID()
  const key    = documentStoragePath(params.programId, tempId, params.file.originalname)
  await uploadObject(params.file.buffer, key, params.file.mimetype)

  try {
    const row = await insertProgramDocument({
      programId:     params.programId,
      kind:          params.kind,
      practiceType:  params.practiceType,
      disciplineId:  params.disciplineId ?? null,
      fileName:      params.file.originalname,
      fileSize:      params.file.size,
      mimeType:      params.file.mimetype,
      storagePath:   key,
      extractedText: params.extractedText ?? null,
      uploadedBy:    params.uploadedBy,
    })
    return row.id
  } catch (err) {
    // DB insert failed after upload — clean up the object so we don't leave
    // orphaned files sitting in storage.
    await deleteObject(key)
    throw err
  }
}

// Academic programs (учебные планы). Access is role-driven — see
// services/programAccess.ts for the resolution rule. Every handler still
// scopes by institution_id (never from the body); the extra scope check
// distinguishes RОП (specific program(s)), oversight (all-ro), and IT admin
// (all-rw).
const router = Router()
router.use(authenticate)
router.use(requireProgramAccess)

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// Loads a program and asserts the caller has at least read access. Callers
// that need write access also call `assertEdit` below.
async function loadReadable(req: Request) {
  const detail = await getProgramDetail(req.params.id, institutionId(req))
  if (!detail) throw new NotFoundError('Учебный план')
  if (!canReadProgram(req.programAccessScope!, detail.org_unit_id)) {
    throw new ForbiddenError('Нет доступа к этой образовательной программе')
  }
  return detail
}

function assertEdit(req: Request, programOrgUnitId: string | null): void {
  if (!canEditProgram(req.programAccessScope!, programOrgUnitId)) {
    throw new ForbiddenError('Только для чтения — редактирование недоступно')
  }
}

// ── Pickable program units — for the import form + detail linker ────────────
// Returns `program` org_units the caller can link a new programme to. Kept as
// a dedicated endpoint so РОПы and polygroup heads (who can't call the
// institution-admin structure endpoint) can still populate the picker.

router.get('/pickable-units', asyncHandler(async (req, res) => {
  const scope = req.programAccessScope!
  if (scope.kind === 'all-rw') {
    res.json(await listProgramUnitsForInstitution(institutionId(req)))
    return
  }
  if (scope.kind === 'specific') {
    res.json(await listProgramUnitsByIds(scope.programUnitIds))
    return
  }
  // all-ro (no active role today) — nothing to pick from
  res.json([])
}))

// ── Programs CRUD ───────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const scope = req.programAccessScope!
  const inst = institutionId(req)
  if (scope.kind === 'specific') {
    res.json(await listProgramsForUnits(inst, scope.programUnitIds))
    return
  }
  // all-rw and all-ro both see everything
  res.json(await listPrograms(inst))
}))

router.post('/', validate(createProgramRules), asyncHandler(async (req, res) => {
  // РОП + УМЦ + IT admin can all create programmes. Creation is really the
  // import step of an externally-authored ОП; the tool then analyses it.
  // РОП (specific scope) MUST link the new programme to one of the `program`
  // org_units they hold — otherwise the scope check on next access would
  // 403 them from their own row.
  const scope = req.programAccessScope!
  if (scope.kind === 'specific') {
    const unit = req.body.org_unit_id
    if (!unit) throw new ValidationError('Выберите вашу образовательную программу в структуре — обязательно для РОП')
    if (!scope.programUnitIds.includes(unit)) {
      throw new ForbiddenError('Можно связать программу только с подразделением, которым вы руководите')
    }
  }
  const program = await createProgram(institutionId(req), req.teacher.id, req.body)
  res.status(201).json(program)
}))

// POST /import — intake form: metadata text fields + two PDFs (описание ОП,
// учебный план). Extracts both, parses учебный план → disciplines and описание →
// competencies/goals, creates the program pre-populated and ready to analyse.
router.post(
  '/import',
  aiLimiter,
  uploadFields([
    { name: 'description', maxCount: 1 },
    { name: 'plan',        maxCount: 1 },
    // Migration 050 — practices stay preserved as originals rather than being
    // reduced to extracted text. Рабочая программа is NOT gathered at intake
    // (migration 051) — КНИТУ carries one per discipline, uploaded later from
    // the programme's document library once each discipline's file is found.
    { name: 'practices',   maxCount: 8 },
  ]),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    // РОП + УМЦ + IT admin can all import. РОП must link on import to a
    // program unit they hold (same rule as POST /).
    const scope = req.programAccessScope!
    if (scope.kind === 'specific') {
      const unit = String(req.body.org_unit_id ?? '')
      if (!unit) throw new ValidationError('Выберите вашу образовательную программу в структуре — обязательно для РОП')
      if (!scope.programUnitIds.includes(unit)) {
        throw new ForbiddenError('Можно связать программу только с подразделением, которым вы руководите')
      }
    }
    const inst = institutionId(req)
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const planFile = files?.plan?.[0]
    const descFile = files?.description?.[0]

    if (!planFile) throw new ValidationError('Загрузите файл учебного плана (PDF).')

    const name = String(req.body.name ?? req.body.specialty_name ?? '').trim()
    if (name.length < 2) throw new ValidationError('Укажите наименование программы.')

    // Validate the practice set UP FRONT — the programme row is created below,
    // and a validation error thrown after creation would leave a half-created
    // programme behind a 400 (the client then retries into a duplicate).
    const practiceFiles = files?.practices ?? []
    const practiceTypes: ProgramPracticeType[] = []
    if (practiceFiles.length > 0) {
      const rawTypes = req.body.practice_types
      const types    = Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : []
      if (types.length !== practiceFiles.length) {
        throw new ValidationError(
          'Каждой практике нужно указать её тип (полей practice_types должно быть столько же, сколько файлов)'
        )
      }
      for (const raw of types) {
        const type = String(raw)
        if (!PROGRAM_PRACTICE_TYPES.includes(type as ProgramPracticeType)) {
          throw new ValidationError(`Неизвестный тип практики: ${type}`)
        }
        if (practiceTypes.includes(type as ProgramPracticeType)) {
          throw new ValidationError(`Тип практики указан дважды: ${type} — на программу допускается один файл каждого типа`)
        }
        practiceTypes.push(type as ProgramPracticeType)
      }
    }

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
    let reportedSemesterTotals: Record<number, number> | undefined = undefined
    if (planText) {
      try {
        const parsed = await parseStudyPlan({ teacherId, institutionId: institutionIdOpt, planText })
        disciplines = parsed.disciplines
        reportedSemesterTotals = parsed.reported_semester_totals
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

    // 3) Always create + populate with whatever we got — the caller edits the rest.
    //    org_unit_id is validated above for `specific` scope; for all-rw it's
    //    optional (blank = link later via the detail page's structure select).
    const program = await createProgram(inst, teacherId, {
      name,
      code:               req.body.code || null,
      duration_semesters: duration,
      specialty_name:     req.body.specialty_name || null,
      education_level:    req.body.education_level || null,
      profile:            req.body.profile || null,
      forms_of_study:     req.body.forms_of_study || null,
      org_unit_id:        (req.body.org_unit_id as string | undefined) || null,
    })

    await setProgramDocs(program.id, { description_text: descText, plan_text: planText })
    if (reportedSemesterTotals) await setReportedSemesterTotals(program.id, reportedSemesterTotals)
    if (competencies.length > 0) await replaceCompetencies(program.id, competencies)
    if (disciplines.length > 0)  await replaceDisciplines(program.id, disciplines)

    // Extract the discipline × competency matrix from описание ОП and populate
    // each discipline's competency_codes authoritatively. This is the fix
    // behind the mapping-confidence guard: without this, УК/ОПК routinely show
    // as «не покрыто» because gen-ed courses (История России, ОРГ) can't be
    // name-inferred to a specific УК. Best-effort — a failed pass leaves
    // codes to per-РПД auto-detect (fillDisciplineCompetencyCodesIfEmpty).
    if (descText && competencies.length > 0 && disciplines.length > 0) {
      try {
        const validCodes = competencies.map((c) => c.code).filter((c): c is string => !!c)
        const matrix = await parseCompetencyMatrix({
          teacherId, institutionId: institutionIdOpt,
          descriptionText: descText, validCodes,
        })
        if (matrix.size > 0) {
          const fresh = await getProgramDetail(program.id, inst)
          if (fresh) {
            const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')
            const byNorm = new Map<string, string[]>()
            for (const [name, codes] of matrix.entries()) byNorm.set(norm(name), codes)
            let filled = 0
            for (const d of fresh.disciplines) {
              const codes = byNorm.get(norm(d.name))
              if (codes && codes.length > 0 && d.id) {
                if (await fillDisciplineCompetencyCodesIfEmpty(d.id, codes)) filled++
              }
            }
            if (filled === 0) warnings.push('Матрица компетенций найдена, но названия дисциплин не совпали — проверьте вручную.')
          }
        }
      } catch (err) {
        logger.warn({ message: 'Program import: competency matrix extraction failed', error: (err as Error).message })
      }
    }

    // Attach практики as first-class documents — the set was fully validated
    // (lengths, type constants, duplicates) BEFORE the programme was created,
    // so nothing here can 400 out and strand a half-created programme.
    // Рабочая программа is attached later, per discipline, via
    // POST /:id/documents (migration 051).
    for (let i = 0; i < practiceFiles.length; i++) {
      await attachProgramDocument({
        programId:    program.id,
        kind:         'practice',
        practiceType: practiceTypes[i],
        file:         practiceFiles[i],
        uploadedBy:   teacherId,
      })
    }

    res.status(201).json({
      program,
      imported: { disciplines: disciplines.length, competencies: competencies.length },
      warnings,
    })
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  // Ancestor chain — used by the frontend to show a non-clickable breadcrumb
  // so an РОП sees which институт their programme sits under.
  const ancestors = detail.org_unit_id
    ? (await listAncestorsOfUnit(detail.org_unit_id)).map((u) => ({
        id: u.id, name: u.name, short_name: u.short_name, type_code: u.type_code,
      }))
    : []
  // Tell the frontend whether *this* caller can edit *this* program, so the
  // UI can render read-only cleanly instead of surfacing 403s on button click.
  const can_edit  = canEditProgram(req.programAccessScope!, detail.org_unit_id)
  const documents = await listProgramDocuments(detail.id)
  res.json({ ...detail, org_unit_ancestors: ancestors, can_edit, documents })
}))

router.patch('/:id', validate(updateProgramRules), asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)
  // Only IT (all-rw) may relink the program's org_unit_id — an РОП must not
  // silently reassign their programme to a different tree slot.
  const scope = req.programAccessScope!
  const patch = { ...req.body }
  if (patch.org_unit_id !== undefined && scope.kind !== 'all-rw') delete patch.org_unit_id
  const program = await updateProgram(req.params.id, institutionId(req), patch)
  if (!program) throw new NotFoundError('Учебный план')
  res.json(program)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  // РОП can delete their own linked programme; all-rw can delete any.
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)
  const ok = await deleteProgram(req.params.id, institutionId(req))
  if (!ok) throw new NotFoundError('Учебный план')
  res.status(204).end()
}))

// ── Bulk content replaces ─────────────────────────────────────────────────────

router.put('/:id/disciplines', validate(replaceDisciplinesRules), asyncHandler(async (req, res) => {
  const program = await findProgram(req.params.id, institutionId(req))
  if (!program) throw new NotFoundError('Учебный план')
  assertEdit(req, program.org_unit_id)

  const disciplines: ProgramDiscipline[] = (req.body.disciplines as ProgramDiscipline[]).map((d, i) => ({
    // MUST forward id — replaceDisciplines uses it to UPDATE in place instead
    // of delete+reinsert. Dropping it here (as this mapping used to) silently
    // regenerated every discipline's UUID on every save/analyze, cascading
    // away every uploaded discipline РПД (program_documents.discipline_id is
    // ON DELETE CASCADE) even though replaceDisciplines itself already knows
    // how to preserve ids when given them.
    id:               typeof d.id === 'string' && d.id.length > 0 ? d.id : undefined,
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
  assertEdit(req, program.org_unit_id)

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
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // running an analysis writes a row — treat as edit

  const analysis = await analyzeProgram({
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
    program:       detail,
  })
  await saveAnalysis(detail.id, analysis)
  res.json(analysis)
}))

router.get('/:id/analysis', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestAnalysis(detail.id))
}))

// GET /:id/analysis.pdf — server-rendered premium PDF of the latest analysis.
router.get('/:id/analysis.pdf', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  const analysis = await getLatestAnalysis(detail.id)
  if (!analysis) throw new ValidationError('Сначала запустите анализ программы.')

  const pdf = await generateProgramReportPdf(detail, analysis)
  const fname = `analysis-${(detail.code || 'program').replace(/[^\w.-]/g, '_')}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
  res.setHeader('Content-Length', pdf.length)
  res.end(pdf)
}))

// ── Attached documents (рабочая программа + практики) ──────────────────────────

// POST /:id/documents — attach a document to an existing programme. Accepts
// one file at a time so the client can add рабочая программа or a single
// практика later without re-uploading the intake set.
router.post(
  '/:id/documents',
  uploadFields([{ name: 'file', maxCount: 1 }]),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    const detail = await loadReadable(req)
    assertEdit(req, detail.org_unit_id)

    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const file  = files?.file?.[0]
    if (!file) throw new ValidationError('Файл не загружен')

    const kind         = String(req.body.kind ?? '') as ProgramDocumentKind
    const practiceType = (req.body.practice_type ? String(req.body.practice_type) : null) as ProgramPracticeType | null

    if (kind !== 'working_programme' && kind !== 'practice') {
      throw new ValidationError('Неверный тип документа')
    }
    if (kind === 'practice') {
      if (!practiceType || !PROGRAM_PRACTICE_TYPES.includes(practiceType)) {
        throw new ValidationError('Укажите тип практики')
      }
      // One file per practice type per programme (FEATURES invariant, backed
      // by the partial unique index from migration 054) — a re-upload of the
      // same type replaces the previous file, same convention as рабочая
      // программа below.
      const existing = await deletePracticeForType(detail.id, practiceType)
      if (existing) {
        await deleteObject(existing.storagePath).catch((err) =>
          logger.warn({ message: 'Failed to delete replaced practice document object', error: (err as Error).message })
        )
      }
    }

    // Migration 051 — рабочая программа belongs to a specific discipline.
    // One current file per discipline: a re-upload replaces the previous row
    // (best-effort object cleanup, same convention as DELETE below).
    let disciplineId: string | null = null
    // Was there a coverage review for this discipline before the replace? The
    // review CASCADEs off the document row, so a re-upload silently drops it —
    // the caller needs to know so they can re-run «Проверить соответствие».
    let replacedReview = false
    if (kind === 'working_programme') {
      disciplineId = String(req.body.discipline_id ?? '')
      if (!disciplineId) {
        throw new ValidationError('Укажите дисциплину, к которой относится рабочая программа')
      }
      // A discipline_id that no longer matches any current discipline almost
      // always means the page is stale — the учебный план was re-saved (which
      // used to churn ids). Give a clear recovery path instead of the
      // misleading "specify the discipline" (they did specify one).
      if (!detail.disciplines.some((d) => d.id === disciplineId)) {
        throw new ValidationError(
          'Дисциплина не найдена — возможно, учебный план был изменён. Обновите страницу и загрузите файл заново.'
        )
      }
      // Check for an existing review BEFORE removing the doc (the CASCADE would
      // erase the row and we'd never know one existed).
      const priorReview = await getLatestReviewForDiscipline(disciplineId)
      replacedReview = !!priorReview
      const existing = await deleteWorkingProgrammeForDiscipline(detail.id, disciplineId)
      if (existing) {
        await deleteObject(existing.storagePath).catch((err) =>
          logger.warn({ message: 'Failed to delete replaced program document object', error: (err as Error).message })
        )
      }
    }

    // Extraction is best-effort — a failed parse doesn't block the attach,
    // it just leaves extracted_text null (the review endpoint then reports a
    // clear error instead of silently checking nothing).
    let extractedText: string | null = null
    try {
      extractedText = (await extractText(file.buffer, file.mimetype)).text
    } catch (err) {
      logger.warn({ message: 'Program document text extraction failed', error: (err as Error).message })
    }

    const id = await attachProgramDocument({
      programId:    detail.id,
      kind,
      practiceType: kind === 'practice' ? practiceType : null,
      disciplineId,
      extractedText,
      file,
      uploadedBy:   req.teacher.id,
    })

    // Auto-detect declared competency codes from the РПД, so the "Проверить
    // соответствие" trigger works without the user having to fill
    // `competency_codes` in the конструктор first. Best-effort: silent on
    // failure, doesn't clobber a manual entry, only runs when we have real
    // text + a target discipline + a non-empty competency set on the programme.
    let detectedCodes: string[] = []
    if (kind === 'working_programme' && disciplineId && extractedText && extractedText.trim().length >= 200) {
      const discipline = detail.disciplines.find((d) => d.id === disciplineId)
      const alreadyHasCodes = (discipline?.competency_codes.length ?? 0) > 0
      const programCodes = detail.competencies.map((c) => c.code).filter((c): c is string => !!c)
      if (discipline && !alreadyHasCodes && programCodes.length > 0) {
        try {
          detectedCodes = await detectDeclaredCompetencyCodes({
            teacherId:              req.teacher.id,
            institutionId:          req.teacher.institution_id ?? undefined,
            documentText:           extractedText,
            programCompetencyCodes: programCodes,
            label:                  discipline.name,
          })
          if (detectedCodes.length > 0) {
            await fillDisciplineCompetencyCodesIfEmpty(disciplineId, detectedCodes)
          }
        } catch (err) {
          logger.warn({
            message: 'Program document: competency-code auto-detect failed',
            error:   (err as Error).message,
          })
        }
      }
    }

    res.status(201).json({ id, detected_competency_codes: detectedCodes, replaced_review: replacedReview })
  })
)

// POST /:id/disciplines/:disciplineId/review — Feature K scoped to a
// programme discipline: checks the discipline's uploaded рабочая программа
// against the competencies it declares (program_disciplines.competency_codes).
router.post('/:id/disciplines/:disciplineId/review', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // runs an AI call + writes a row — treat as edit

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')
  if (discipline.competency_codes.length === 0) {
    throw new ValidationError(
      'У дисциплины не указаны компетенции — заполните их в конструкторе плана перед проверкой.'
    )
  }

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found) throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  if (!found.extractedText) {
    throw new ValidationError('Не удалось извлечь текст из загруженного файла — перезагрузите документ.')
  }

  const competencies = detail.competencies.filter(
    (c) => c.code != null && discipline.competency_codes.includes(c.code)
  )
  if (competencies.length === 0) {
    throw new ValidationError('Заявленные коды компетенций дисциплины не найдены среди компетенций программы.')
  }

  const result = await reviewDocumentCoverage({
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
    documentText:  found.extractedText,
    competencies,
    label:         discipline.name,
  })

  const review = await insertReview({
    programId:    detail.id,
    disciplineId: discipline.id!,
    documentId:   found.document.id,
    result,
  })
  res.status(201).json(review)
}))

// GET /:id/discipline-reviews — latest review per discipline, for the Report tab.
router.get('/:id/discipline-reviews', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestReviewByDiscipline(detail.id))
}))

// GET /:id/documents/:docId/download — stream the original file to the caller.
router.get('/:id/documents/:docId/download', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  const found  = await findProgramDocument(req.params.docId, detail.id)
  if (!found) throw new NotFoundError('Документ')

  const buf = await downloadObject(found.storagePath)
  res.setHeader('Content-Type', found.document.mime_type)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(found.document.file_name)}`
  )
  res.setHeader('Content-Length', buf.length)
  res.end(buf)
}))

router.delete('/:id/documents/:docId', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)

  const found = await findProgramDocument(req.params.docId, detail.id)
  if (!found) throw new NotFoundError('Документ')

  await deleteProgramDocument(found.document.id, detail.id)
  // Storage cleanup is best-effort — an orphaned object costs a few kB and is
  // logged; better than failing the delete if S3 hiccups.
  await deleteObject(found.storagePath).catch((err) =>
    logger.warn({ message: 'Failed to delete program document object', error: (err as Error).message })
  )
  res.status(204).end()
}))

export default router
