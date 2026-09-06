import { Router, Request } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireProgramAccess } from '../middleware/requireProgramAccess'
import { requireDomain } from '../middleware/requireDomain'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { recordArtifactEvent } from '../db/queries/artifactEvents'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError, ForbiddenError } from '../errors/AppError'
import {
  createProgramRules, updateProgramRules, replaceDisciplinesRules, replaceCompetenciesRules,
} from '../validation/programValidation'
import {
  listPrograms, listProgramsForUnits, createProgram, findProgram, getProgramDetail, updateProgram, deleteProgram,
  replaceDisciplines, replaceCompetencies, saveAnalysis, getLatestAnalysis,
  listProgramUnitsForInstitution, listProgramUnitsByIds,
  fillDisciplineCompetencyCodesIfEmpty, setDisciplineResponsible, listAssignableTeachers,
} from '../db/queries/programs'
import { isTeacherInInstitution } from '../db/queries/orgUnits'
import { listSubmittedForPrograms, findSubmissionByDiscipline } from '../db/queries/rpdSubmissions'
import { transitionSubmission } from '../services/rpdSubmissions'
import { canEditProgram, canReadProgram } from '../services/programAccess'
import { listAncestorsOfUnit } from '../db/queries/orgUnits'
import { analyzeProgram, persistTopology, persistContentUnits, derivePkFormulationFindings } from '../services/programAnalysis'
import { reviewDocumentCoverage, detectDeclaredCompetencyCodes } from '../services/documentReview'
import { reviewPlacement } from '../services/placementReview'
import { reviewMto } from '../services/mtoReview'
import { diffWorkingProgrammes } from '../services/programDiff'
import { generateProgramReportPdf } from '../services/programReportPdf'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { extractText } from '../services/documentExtractor'
import { parseStudyPlan, parseDescription, parseCompetencyMatrix } from '../services/programImport'
import { setProgramDocs, setReportedSemesterTotals } from '../db/queries/programs'
import { getProgramTopology, listContentUnitsByDiscipline, replaceDeclaredPrerequisites } from '../db/queries/programTopology'
import { downloadObject, deleteObject } from '../services/objectStorage'
import {
  listProgramDocuments, findProgramDocument, deleteProgramDocument,
  findWorkingProgrammeForDiscipline, supersedeWorkingProgrammeForDiscipline, deletePracticeForType,
  supersedeFosForDiscipline,
  listWorkingProgrammeVersions,
} from '../db/queries/programDocuments'
import { attachProgramDocument } from '../services/programDocumentAttach'
import { insertReview, getLatestReviewByDiscipline, getLatestReviewForDiscipline } from '../db/queries/programDocumentReviews'
import { insertPlacementReview, getLatestPlacementReviewsByProgram } from '../db/queries/programPlacementReviews'
import { insertMtoReview, getLatestMtoReviewsByProgram } from '../db/queries/programMtoReviews'
import { insertDiff, findDiff } from '../db/queries/programDocumentDiffs'
import {
  findCourseByTeacherAndName, findCoursesByTeacher, createCourse, setCourseSyllabusText,
} from '../db/queries/courses'
import { getInstitutionById } from '../db/queries/institutions'
import { fetchDocumentFromUrl, fetchPageHtml, resolveAllowedDomains, type FetchedFile } from '../services/documentFetch'
import { parseSvedenPage, selectProgramRow, matchDiscipline } from '../services/svedenParser'
import { getLimits } from '../config/planLimits'
import { logger } from '../lib/logger'
import { getProfstandardRefsForDirection } from '../db/queries/fgos'
import { getPublishedOtfForCodes } from '../db/queries/profstandards'
import { inferFgosLevel } from '../services/fgosMatch'
import { getLatestMarketEvidence, createMarketEvidence, updateMarketEvidenceText } from '../db/queries/programMarketEvidence'
import { fetchVacancySnapshot, SUPPORTED_REGIONS } from '../services/labourMarket'
import { generateMarketEvidenceSection, type StrategyExcerpt } from '../services/marketEvidenceGenerator'
import { embed } from '../services/deepseek'
import { findRelevantStrategyChunksScored } from '../db/queries/institutionStrategyDoc'
import type {
  ProgramDiscipline, ProgramCompetency,
  ProgramPracticeType, ProgramDocumentKind,
} from '../../../shared/types'
import { PROGRAM_PRACTICE_TYPES } from '../../../shared/types'

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

// Resolve a single document from EITHER a multipart upload OR a pasted URL.
// Lets a user paste a link to their university's document system instead of
// downloading + re-uploading; the fetch is restricted to the institution's
// allowlisted domains (services/documentFetch.ts). Returns undefined when
// neither an upload nor a URL is present, so callers keep their own
// "file required" messaging.
async function resolveUploadOrUrl(
  req: Request,
  uploaded: Express.Multer.File | undefined,
  urlValue: unknown,
): Promise<FetchedFile | undefined> {
  if (uploaded) return uploaded
  const url = typeof urlValue === 'string' ? urlValue.trim() : ''
  if (!url) return undefined
  const institution = req.teacher.institution_id ? await getInstitutionById(req.teacher.institution_id) : null
  return fetchDocumentFromUrl(url, resolveAllowedDomains(institution))
}

// ── Pickable program units — for the import form + detail linker ────────────
// Returns `program` org_units the caller can link a new programme to. Kept as
// a dedicated endpoint so РОПы and polygroup heads (who can't call the
// institution-admin structure endpoint) can still populate the picker.

// РОП Студия v0 (TODO.md Feature Z) — the full trudvsem-verified region
// list (see services/labourMarket.ts for how each code was confirmed).
// Exposed as an endpoint rather than duplicated in the frontend so there's
// one source of truth for 90 entries, not two to keep in sync.
router.get('/regions', asyncHandler(async (_req, res) => {
  res.json(SUPPORTED_REGIONS)
}))

router.get('/pickable-units', asyncHandler(async (req, res) => {
  const scope = req.programAccessScope!
  if (scope.kind === 'all-rw') {
    res.json(await listProgramUnitsForInstitution(institutionId(req)))
    return
  }
  if (scope.kind === 'specific') {
    // Pickable = where a NEW programme may be linked, so editable-only.
    res.json(await listProgramUnitsByIds(scope.editableUnitIds))
    return
  }
  // all-ro (no active role today) — nothing to pick from
  res.json([])
}))

// GET /teachers — lean institution-wide list for the «Ответственный за
// дисциплину» picker (docs/RPD-WORKFLOW.md phase 4a). Deliberately its own
// endpoint on THIS router rather than institution.ts's /teachers (gated
// `teaching:view`) — a РОП typically holds `curriculum` access without a
// `teaching` grant (docs/ACCESS-MATRIX.md Table A), so that gate would 403
// exactly the caller who needs this picker.
router.get('/teachers', asyncHandler(async (req, res) => {
  res.json(await listAssignableTeachers(institutionId(req)))
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
    if (!scope.editableUnitIds.includes(unit)) {
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
      if (!scope.editableUnitIds.includes(unit)) {
        throw new ForbiddenError('Можно связать программу только с подразделением, которым вы руководите')
      }
    }
    const inst = institutionId(req)
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    // Учебный план + описание ОП can each be an upload or a pasted link to the
    // university's document system. (Практики at intake stay upload-only — they
    // get link support via the per-programme document library instead.)
    const planFile = await resolveUploadOrUrl(req, files?.plan?.[0], req.body.plan_url)
    const descFile = await resolveUploadOrUrl(req, files?.description?.[0], req.body.description_url)

    if (!planFile) throw new ValidationError('Загрузите файл учебного плана (PDF) или вставьте ссылку на него.')

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
    kind:                 c.kind === 'goal' ? 'goal' : 'competency',
    code:                 c.code ?? null,
    title:                c.title,
    sort_order:           c.sort_order ?? i,
    profstandard_otf_id:  c.profstandard_otf_id ?? null,
    indicators: (c.indicators ?? []).map((ind, j) => ({
      code: ind.code, title: ind.title, sort_order: ind.sort_order ?? j,
    })),
  }))
  await replaceCompetencies(program.id, competencies)
  const detail = await getProgramDetail(program.id, institutionId(req))
  // Inline formulation check (methodist feedback item 3) — cheap and
  // deterministic (services/pkFormulation.ts), so it runs on every save
  // instead of needing a second round-trip; the Конструктор shows any
  // warning right under the offending ПК row.
  const formulationWarnings = detail ? await derivePkFormulationFindings(detail.competencies) : []
  res.json({ ...detail, formulation_warnings: formulationWarnings })
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
  const saved = await saveAnalysis(detail.id, analysis)
  // Best-effort — a topology-persistence failure must never break the
  // analysis report the РОП is waiting on (docs/topology-spec.md, Inc 0).
  // Edges/links/ФГОС-matching are cheap (no extra LLM calls) — awaited so
  // they're ready the moment the caller opens the Топология tab.
  await persistTopology(detail, analysis, saved.id, req.teacher.id).catch((err) => {
    logger.warn({ message: 'Topology persistence failed', programId: detail.id, error: (err as Error).message })
  })
  // Content-unit extraction is NOT awaited — one LLM round trip per uploaded
  // РПД, which on a real programme can run for minutes past this point (see
  // persistContentUnits' own comment). Never block the response on it.
  persistContentUnits(detail, req.teacher.id).catch((err) => {
    logger.warn({ message: 'Content-unit persistence failed', programId: detail.id, error: (err as Error).message })
  })
  res.json(analysis)
}))

router.get('/:id/analysis', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestAnalysis(detail.id))
}))

// GET /:id/topology — read-side for the «Топология» tab (Increment 1). Gated
// explicitly on the curriculum domain (docs/topology-spec.md §6) — sibling
// routes in this file rely only on requireProgramAccess + the SQL-level
// domain filter in getProgramAccessScope; this is the first to state the
// domain per-route, as the spec calls for.
router.get('/:id/topology', requireDomain('curriculum', 'view'), asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getProgramTopology(detail.id))
}))

// GET /:id/disciplines/:disciplineId/content-units — lazy per-discipline
// lookup for the Топология graph's detail panel (docs/topology-spec.md,
// pulling Increment 2's read path forward — the extraction itself shipped
// with Increment 0b, nothing read it back until now).
router.get('/:id/disciplines/:disciplineId/content-units', requireDomain('curriculum', 'view'), asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')
  res.json(await listContentUnitsByDiscipline(discipline.id!))
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

  // artifact_id is the programme, not the analysis: getLatestAnalysis returns
  // the stored `result` JSON only — program_analyses rows are not individually
  // addressable, so the programme is the finest identity available here.
  recordArtifactEvent({
    kind: 'program_analysis', event: 'exported', artifactId: detail.id,
    teacherId: req.teacher.id, institutionId: req.teacher.institution_id,
    format: 'pdf',
  })
}))

// GET /:id/profstandard-options — Конструктор's ПК↔ОТФ picker (migration
// 115, методист feedback item 3). Resolves the programme's own профстандарты
// (via the ФГОС registry, same lookup market-evidence below already does)
// and each one's published ОТФ list, flagging every ОТФ with whether its
// «требования к образованию» matches this programme's own level — computed
// server-side via fgosMatch.ts's inferFgosLevel (already relied on at line
// ~558 below and tested for exactly this free-text parsing), never
// re-derived client-side.
router.get('/:id/profstandard-options', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  if (!detail.code) { res.json({ profstandards: [] }); return }
  const fgosLevel = inferFgosLevel(detail)
  if (!fgosLevel) { res.json({ profstandards: [] }); return }

  const refs = await getProfstandardRefsForDirection(detail.code, fgosLevel)
  const standards = await getPublishedOtfForCodes(refs.map((r) => r.code))

  const profstandards = standards.map((s) => ({
    id:   s.id,
    code: s.code,
    name: s.name,
    otf: s.otf.map((o) => ({
      id:                     o.id,
      otf_code:               o.otf_code,
      name:                   o.name,
      qualification_level:    o.qualification_level,
      education_requirement:  o.education_requirement,
      is_verbatim_verified:   o.is_verbatim_verified,
      sort_order:             o.sort_order,
      level_match: inferFgosLevel({ level: null, education_level: o.education_requirement }) === fgosLevel,
    })),
  }))

  res.json({ profstandards })
}))

// ── РОП Студия v0 — market evidence (TODO.md Feature Z, Phase 0) ───────────────
// «Обоснование актуальности»: citation-grounded market-relevance text built
// from real trudvsem.ru vacancy data + the direction's профстандарты
// (already in the ФГОС registry, migration 088). Generation persists a new
// row (program_market_evidence, migration 089) — cached-latest-wins, same
// shape as program_analyses above. Never auto-published anywhere — the РОП
// edits the text in place (rule #3), same posture as every other AI-assisted
// authoring surface in the app.

router.get('/:id/market-evidence', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestMarketEvidence(detail.id))
}))

router.post('/:id/market-evidence', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // generates + persists a row — treat as edit

  const regionCodes = Array.isArray(req.body.region_codes)
    ? req.body.region_codes.map((c: unknown) => String(c).trim()).filter(Boolean)
    : []
  if (regionCodes.length === 0) throw new ValidationError('Выберите хотя бы один регион.')
  const unknownCode = regionCodes.find((c: string) => !SUPPORTED_REGIONS.some((r) => r.code === c))
  if (unknownCode) throw new ValidationError('Неизвестный регион.')

  const professions = Array.isArray(req.body.professions)
    ? req.body.professions.map((p: unknown) => String(p).trim()).filter(Boolean)
    : []
  if (professions.length === 0) throw new ValidationError('Укажите хотя бы одну профессию для поиска вакансий.')

  if (!detail.code) throw new ValidationError('У программы не указан код направления — обоснование не с чем связать.')
  const fgosLevel = inferFgosLevel(detail)
  if (!fgosLevel) throw new ValidationError('У программы не указан уровень образования.')

  const profstandardRefs = (await getProfstandardRefsForDirection(detail.code, fgosLevel))
    .map((r) => ({ code: r.code, name: r.name }))

  const snapshot = await fetchVacancySnapshot(regionCodes, professions)
  const strategyExcerpts = await findStrategyExcerpts(req, detail.name, professions)

  const { text } = await generateMarketEvidenceSection({
    programTitle:  detail.name,
    profstandards: profstandardRefs,
    snapshot,
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
    strategyExcerpts,
  })
  if (!text) throw new ValidationError('Не удалось сгенерировать текст — попробуйте ещё раз.')

  const evidence = await createMarketEvidence({
    programId: detail.id, snapshot, professions, profstandardRefs, strategyExcerpts,
    sectionText: text, createdBy: req.teacher.id,
  })
  res.status(201).json(evidence)
}))

// Plane-2 retrieval (Feature Z Phase 0 pilot completion) — same
// cosine-distance refusal gate services/docChat.ts uses for "Спроси
// документ": a weak/no match means Plane-2 is silently skipped for this
// generation, never forced. Duplicated rather than imported — docChat.ts's
// constant is course-scoped grounded chat, an unrelated feature; coupling
// the two for one shared literal isn't worth it.
const STRATEGY_UNGROUNDED_DISTANCE = 0.35
const MAX_STRATEGY_EXCERPTS = 2

async function findStrategyExcerpts(
  req: Request,
  programTitle: string,
  professions: string[]
): Promise<StrategyExcerpt[]> {
  const institutionId = req.teacher.institution_id
  if (!institutionId) return []

  const query = `${programTitle} ${professions.join(' ')}`.trim()
  const vector = await embed(query, { teacherId: req.teacher.id, institutionId, feature: 'embedding' })
  const chunks = await findRelevantStrategyChunksScored(institutionId, vector, MAX_STRATEGY_EXCERPTS)

  return chunks
    .filter((c) => c.distance <= STRATEGY_UNGROUNDED_DISTANCE)
    .map((c) => ({ text: c.text, pageStart: c.page_start, pageEnd: c.page_end }))
}

router.put('/:id/market-evidence/:evidenceId', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)

  const sectionText = String(req.body.section_text ?? '').trim()
  if (!sectionText) throw new ValidationError('Текст не может быть пустым.')

  const updated = await updateMarketEvidenceText(req.params.evidenceId, detail.id, sectionText)
  if (!updated) throw new NotFoundError('Обоснование актуальности')
  res.json(updated)
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
    // Either an uploaded file or a pasted university-system link.
    const file  = await resolveUploadOrUrl(req, files?.file?.[0], req.body.file_url)
    if (!file) throw new ValidationError('Файл не загружен')

    const kind         = String(req.body.kind ?? '') as ProgramDocumentKind
    const practiceType = (req.body.practice_type ? String(req.body.practice_type) : null) as ProgramPracticeType | null

    if (kind !== 'working_programme' && kind !== 'practice' && kind !== 'fos') {
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
    // One CURRENT file per discipline: a re-upload supersedes the previous
    // row rather than deleting it (migration 084) — the old extraction is
    // kept so the discipline's «Что изменилось с прошлого года» diff has
    // something to compare against. Object storage is untouched too; only
    // the DB pointer moves.
    let disciplineId: string | null = null
    // Was there a coverage review for the version we're about to supersede?
    // That review isn't deleted anymore, but it now describes a file that's
    // no longer current — the caller needs to know so it can prompt
    // «Проверить соответствие» again rather than showing a stale result.
    let replacedReview = false
    if (kind === 'working_programme' || kind === 'fos') {
      disciplineId = String(req.body.discipline_id ?? '')
      if (!disciplineId) {
        throw new ValidationError(
          kind === 'fos' ? 'Укажите дисциплину, к которой относится ФОС' : 'Укажите дисциплину, к которой относится рабочая программа'
        )
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
      if (kind === 'working_programme') {
        const priorReview = await getLatestReviewForDiscipline(disciplineId)
        replacedReview = !!priorReview
        await supersedeWorkingProgrammeForDiscipline(detail.id, disciplineId)
      } else {
        await supersedeFosForDiscipline(detail.id, disciplineId)
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

// POST /:id/documents/discover — bulk РПД discovery from the university's
// mandated /sveden/education disclosure page. Fetches the page (same
// allowlist + SSRF discipline as single-document pull), parses the microdata
// table, scopes to this programme's row, and returns a checklist manifest.
// Import itself stays client-driven: the frontend confirms the checklist and
// feeds each item through the existing POST /:id/documents with file_url —
// per-item progress/retry for free, no new job infrastructure.
router.post('/:id/documents/discover', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)

  const pageUrl = String(req.body.page_url ?? '').trim()
  if (!pageUrl) throw new ValidationError('Вставьте ссылку на страницу «Сведения об образовательной организации → Образование».')
  // Optional re-run against a specific year tab (см. availableYears/selectedYear
  // in the response) — some universities (verified: kstu.ru) bundle several
  // years' programmes into one page behind client-side tabs.
  const requestedYear = req.body.year ? String(req.body.year) : undefined

  const institution = req.teacher.institution_id ? await getInstitutionById(req.teacher.institution_id) : null
  const { html, finalUrl } = await fetchPageHtml(pageUrl, resolveAllowedDomains(institution))

  const { rows, availableYears, selectedYear } = parseSvedenPage(html, finalUrl, requestedYear)
  if (rows.length === 0) {
    throw new ValidationError(
      'На странице не найдено таблицы с документами программ. Проверьте, что это страница раздела «Образование» (обычно /sveden/education).'
    )
  }

  const row = selectProgramRow(rows, { code: detail.code, name: detail.name })
  if (!row) {
    // Ambiguous — either no row matched, or (verified against kstu.ru) the
    // code matched several rows sharing one code+name across different
    // профили with no way to tell them apart from the programme's own name.
    // `profile` is included specifically so those candidates render
    // distinguishably instead of as identical-looking duplicates.
    res.json({
      matched:         null,
      candidates:      rows.filter((r) => r.docs.length > 0).map((r) => ({ code: r.code, name: r.name, profile: r.profile, doc_count: r.docs.length })),
      items:           [],
      skipped:         {},
      available_years: availableYears,
      selected_year:   selectedYear,
    })
    return
  }

  const currentDocs   = await listProgramDocuments(detail.id)
  const rpdByDiscipline = new Set(
    currentDocs.filter((d) => d.kind === 'working_programme' && !d.superseded_at && d.discipline_id).map((d) => d.discipline_id as string)
  )
  const usedPracticeTypes = new Set(
    currentDocs.filter((d) => d.kind === 'practice' && d.practice_type).map((d) => d.practice_type as ProgramPracticeType)
  )

  const disciplineRefs = detail.disciplines
    .filter((d): d is ProgramDiscipline & { id: string } => !!d.id)
    .map((d) => ({ id: d.id, name: d.name }))

  const skipped: Record<string, number> = {}
  const items: Array<{
    url: string; text: string; kind: 'working_programme' | 'practice'
    practice_type: ProgramPracticeType | null
    discipline_id: string | null; match_confidence: 'exact' | 'fuzzy' | null
    has_current_doc: boolean
  }> = []
  const seenUrls = new Set<string>()

  for (const doc of row.docs) {
    if (doc.kind !== 'working_programme' && doc.kind !== 'practice') {
      skipped[doc.kind] = (skipped[doc.kind] ?? 0) + 1
      continue
    }
    if (seenUrls.has(doc.url)) continue
    seenUrls.add(doc.url)

    if (doc.kind === 'working_programme') {
      const match = matchDiscipline(doc.text, disciplineRefs)
      items.push({
        url: doc.url, text: doc.text, kind: 'working_programme',
        practice_type:    null,
        discipline_id:    match?.id ?? null,
        match_confidence: match?.confidence ?? null,
        has_current_doc:  match ? rpdByDiscipline.has(match.id) : false,
      })
    } else {
      items.push({
        url: doc.url, text: doc.text, kind: 'practice',
        practice_type:    doc.practice_type,
        discipline_id:    null,
        match_confidence: null,
        has_current_doc:  doc.practice_type ? usedPracticeTypes.has(doc.practice_type) : false,
      })
    }
  }

  res.json({
    matched:         { code: row.code, name: row.name, profile: row.profile },
    candidates:      [],
    items,
    skipped,
    available_years: availableYears,
    selected_year:   selectedYear,
  })
}))

// PUT /:id/disciplines/:disciplineId/responsible — assign (or clear) the
// teacher who must author and submit this discipline's РПД
// (docs/RPD-WORKFLOW.md phase 4a). Body: { teacherId: string | null }.
//
// Separate from PUT /:id/disciplines (the plan structure) on purpose: saving
// the учебный план must never silently reassign or clear РПД ownership.
router.put('/:id/disciplines/:disciplineId/responsible', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')

  const raw = req.body?.teacherId
  const teacherId = raw === null || raw === undefined || raw === '' ? null : String(raw)

  // Only a member of this institution can be made responsible — otherwise a
  // guessed uuid would hand a stranger a submission surface into this plan.
  if (teacherId && !(await isTeacherInInstitution(teacherId, institutionId(req)))) {
    throw new ValidationError('Преподаватель не найден в вашей организации')
  }

  const ok = await setDisciplineResponsible(detail.id, discipline.id!, teacherId)
  if (!ok) throw new NotFoundError('Дисциплина')
  res.json({ ok: true, responsible_teacher_id: teacherId })
}))

// ─── РПД approval — РОП's review queue (docs/RPD-WORKFLOW.md phase 4b) ────────

// GET /:id/submissions — 'submitted' items for this programme, i.e. the
// РОП's own review queue scoped to one plan (the frontend calls this once
// per programme the РОП holds — see /rop-studio's aggregate queue view).
router.get('/:id/submissions', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await listSubmittedForPrograms([detail.id]))
}))

// POST /:id/disciplines/:disciplineId/submission/:action — 'return' or
// 'forward'. Only the transitions valid FROM 'submitted' — trying either on
// a submission not currently 'submitted' (e.g. already forwarded to УМЦ)
// fails via rpdSubmissionState's own table, not a route-level guess.
router.post('/:id/disciplines/:disciplineId/submission/:action', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)

  const action = req.params.action
  if (action !== 'return' && action !== 'forward') {
    throw new ValidationError('Недопустимое действие — только return или forward')
  }

  const submission = await findSubmissionByDiscipline(req.params.disciplineId)
  if (!submission || submission.program_id !== detail.id) throw new NotFoundError('Заявка на проверку')

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : undefined
  if (action === 'return' && !comment) {
    throw new ValidationError('Укажите замечания — без них преподаватель не поймёт, что исправлять')
  }

  const result = await transitionSubmission(submission.id, action, req.teacher.id, comment)
  if ('error' in result) throw new ValidationError(result.error)
  res.json(result.submission)
}))

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

// POST /:id/disciplines/:disciplineId/placement-review — «Место дисциплины
// в структуре ОП» (РПД §2). Checks declared predecessor/successor
// disciplines and направление/профиль against the real plan, the programme
// header, other disciplines' own §2 (asymmetry), and — best-effort — content
// affinity (weak rationale / missing prerequisite). See
// services/placementReview.ts for the full rationale.
router.post('/:id/disciplines/:disciplineId/placement-review', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // runs an AI call + writes a row — treat as edit

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found) throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  if (!found.extractedText) {
    throw new ValidationError('Не удалось извлечь текст из загруженного файла — перезагрузите документ.')
  }

  const siblingReviews = (await getLatestPlacementReviewsByProgram(detail.id))
    .filter((r) => r.discipline_id !== discipline.id)

  const result = await reviewPlacement({
    teacherId:      req.teacher.id,
    program:        detail,
    discipline,
    allDisciplines: detail.disciplines,
    documentText:   found.extractedText,
    siblingReviews,
  })

  const review = await insertPlacementReview({
    programId:    detail.id,
    disciplineId: discipline.id!,
    documentId:   found.document.id,
    result,
  })

  // Densify the topology graph for free (docs/topology-spec.md open question
  // #2): matched, non-inverted declared predecessors become origin='declared'
  // edges. Best-effort — a failure here must not lose the review itself.
  const goodEdges = result.declared
    .filter((d) => d.role === 'predecessor' && d.resolution === 'internal' && d.discipline_id)
    .map((d) => ({
      disciplineId:             discipline.id!,
      prerequisiteDisciplineId: d.discipline_id!,
      reason:                   'Указано в разделе «Место дисциплины в структуре ОП»',
      inverted:                 d.semester != null && d.semester > discipline.semester,
    }))
  await replaceDeclaredPrerequisites(detail.id, discipline.id!, goodEdges).catch((err) => {
    logger.warn({ message: 'Could not sync declared prerequisites into topology graph', disciplineId: discipline.id, error: (err as Error).message })
  })

  res.status(201).json(review)
}))

// POST /:id/disciplines/:disciplineId/mto-review — «Материально-техническое
// обеспечение» (РПД §12), requested by the УМЦ head: catches a §12 that
// only lists generic classroom items instead of named licensed software,
// and flags tools the discipline's own лабораторные/практические content
// mentions that §12 never lists. See services/mtoReview.ts — Phase 1, no
// licensed-software registry.
router.post('/:id/disciplines/:disciplineId/mto-review', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // runs an AI call + writes a row — treat as edit

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found) throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  if (!found.extractedText) {
    throw new ValidationError('Не удалось извлечь текст из загруженного файла — перезагрузите документ.')
  }

  const siblingMtoReviews = (await getLatestMtoReviewsByProgram(detail.id))
    .filter((r) => r.discipline_id !== discipline.id)

  const result = await reviewMto({
    teacherId:      req.teacher.id,
    discipline,
    allDisciplines: detail.disciplines,
    documentText:   found.extractedText,
    siblingReviews: siblingMtoReviews,
  })

  const review = await insertMtoReview({
    programId:    detail.id,
    disciplineId: discipline.id!,
    documentId:   found.document.id,
    result,
  })
  res.status(201).json(review)
}))

// GET /:id/mto-reviews — latest «Материально-техническое обеспечение»
// review per discipline.
router.get('/:id/mto-reviews', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestMtoReviewsByProgram(detail.id))
}))

// POST /:id/disciplines/:disciplineId/diff — «Что изменилось с прошлого
// года» (Research.md §9.6): compares the discipline's current РПД against
// the version it superseded (migration 084). Cached per (old, new) document
// pair so reopening the panel doesn't re-run the comparison.
router.post('/:id/disciplines/:disciplineId/diff', aiLimiter, asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  assertEdit(req, detail.org_unit_id)   // runs an AI call + writes a row — treat as edit

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')

  const versions = await listWorkingProgrammeVersions(detail.id, discipline.id!)
  if (versions.length < 2) {
    throw new ValidationError(
      'Нет предыдущей версии РПД для этой дисциплины — сравнение появится после повторной загрузки обновлённого файла.'
    )
  }
  const [current, previous] = versions
  if (!current.extractedText || !previous.extractedText) {
    throw new ValidationError('Не удалось извлечь текст одной из версий — перезагрузите документ.')
  }

  const cached = await findDiff(previous.id, current.id)
  if (cached) {
    res.json(cached)
    return
  }

  const competencies = detail.competencies.filter(
    (c) => c.code != null && discipline.competency_codes.includes(c.code)
  )

  const result = await diffWorkingProgrammes({
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
    oldText:       previous.extractedText,
    newText:       current.extractedText,
    competencies,
    label:         discipline.name,
  })

  const diff = await insertDiff({
    programId:     detail.id,
    disciplineId:  discipline.id!,
    oldDocumentId: previous.id,
    newDocumentId: current.id,
    result,
  })
  res.status(201).json(diff)
}))

// POST /:id/disciplines/:disciplineId/studio-course — bridge into РПД-студия.
// The студия works off the teacher's *personal* «Предметы» (courses), not the
// programme structure, so a РОП who uploaded a discipline's РПД here would
// otherwise have to re-create the discipline as a предмет by hand. This
// endpoint finds (by name, case-insensitive) or creates that personal course,
// seeding syllabus_text from the uploaded РПД's extracted text, and returns
// its id so the client can navigate to /curriculum?tab=studio&course=<id>.
// Read access suffices — the created course is the caller's own, the
// programme itself is untouched.
router.post('/:id/disciplines/:disciplineId/studio-course', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)

  const discipline = detail.disciplines.find((d) => d.id === req.params.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  const rpdText = (found?.extractedText ?? '').trim()
  if (rpdText.length < 80) {
    throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины — студии нужен её текст.')
  }

  const existing = await findCourseByTeacherAndName(req.teacher.id, discipline.name)
  if (existing) {
    // Reuse the предмет; backfill the syllabus only if it's effectively empty —
    // never clobber text the teacher already maintains there.
    if ((existing.syllabus_text ?? '').trim().length < 80) {
      await setCourseSyllabusText(existing.id, rpdText)
    }
    res.json({ course_id: existing.id, created: false })
    return
  }

  // Same cap the regular POST /api/courses enforces via checkResourceLimit —
  // applied only on the create branch so reuse keeps working at the limit.
  const limit = getLimits(req.teacher.plan_tier).maxCourses
  if (limit !== Infinity) {
    const count = (await findCoursesByTeacher(req.teacher.id)).length
    if (count >= limit) {
      res.status(403).json({
        error:    `Достигнут лимит предметов для вашего тарифа (${limit}).`,
        code:     'RESOURCE_LIMIT_REACHED',
        resource: 'courses',
        limit,
        current:  count,
        upgrade:  true,
      })
      return
    }
  }

  const course = await createCourse(req.teacher.id, { name: discipline.name, syllabus_text: rpdText })
  res.status(201).json({ course_id: course.id, created: true })
}))

// GET /:id/discipline-reviews — latest review per discipline, for the Report tab.
router.get('/:id/discipline-reviews', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestReviewByDiscipline(detail.id))
}))

// GET /:id/placement-reviews — latest «Место дисциплины в структуре ОП»
// review per discipline.
router.get('/:id/placement-reviews', asyncHandler(async (req, res) => {
  const detail = await loadReadable(req)
  res.json(await getLatestPlacementReviewsByProgram(detail.id))
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

  recordArtifactEvent({
    kind: 'program_document', event: 'exported', artifactId: found.document.id,
    teacherId: req.teacher.id, institutionId: req.teacher.institution_id,
    format: found.document.mime_type, metadata: { docKind: found.document.kind },
  })
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
