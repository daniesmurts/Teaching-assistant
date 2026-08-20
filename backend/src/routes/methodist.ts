import { Router, type Request } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { requireDomainOnUnitTypes } from '../middleware/requireDomain'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { createMethodistRunRules, methodistRunIdRules } from '../validation/methodistValidation'
import { loadReadableDiscipline } from '../services/methodist/target'
import { type CheckKey } from '../services/methodist/checks'
import { getJobQueue } from '../services/jobQueue'
import { METHODIST_RUN_QUEUE, type RunMethodistChecksParams } from '../services/methodist/runWorker'
import { createMethodistRun, getMethodistRun, listRecentMethodistRuns } from '../db/queries/methodistRuns'
import { getUmcDashboard } from '../services/umcDashboard'
import { getRootUnitForInstitution } from '../db/queries/orgUnits'
import { METHODIST_UNIT_TYPES } from '../services/accessScope'
import { uploadConfig, verifyFileContent } from '../middleware/fileValidation'
import { extractText } from '../services/documentExtractor'
import { reviewSyllabus } from '../services/syllabusReview'

const router = Router()
router.use(authenticate)

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// Subtree scoping — same pattern as routes/umcDashboard.ts's
// resolveUmuPrefixes: a root-anchored grant (every УМУ/РУМЦ/МУМЦ grant in
// practice today) sees the whole institution; a hypothetical subtree-scoped
// grant stays scoped to it.
async function resolveMethodistPrefixes(req: Request): Promise<string[] | undefined> {
  if (!req.domainScope) return undefined
  const root = await getRootUnitForInstitution(institutionId(req))
  if (root && req.domainScope.pathPrefixes.includes(root.path)) return undefined
  return req.domainScope.pathPrefixes
}

// POST /api/methodist/runs — Кабинет методиста (TODO Feature AM, Phase 2).
// Runs the selected checks for one programme discipline asynchronously
// (pg-boss — up to 4 independent LLM calls, too slow to hold a request
// open for). Target + access validated here, before enqueueing, so a bad
// programme/discipline id or a caller without read access surfaces as an
// immediate 404/403 instead of a run that's queued only to fail.
router.post(
  '/runs',
  aiLimiter,
  validate(createMethodistRunRules),
  asyncHandler(async (req, res) => {
    const { program_id, discipline_id, checks } = req.body as {
      program_id: string; discipline_id: string; checks: CheckKey[]
    }

    await loadReadableDiscipline({ programId: program_id, disciplineId: discipline_id }, req.teacher)

    const run = await createMethodistRun({
      teacherId: req.teacher.id, programId: program_id, disciplineId: discipline_id, checks,
    })

    const jobPayload: RunMethodistChecksParams = {
      runId: run.id, teacherId: req.teacher.id, programId: program_id, disciplineId: discipline_id, checks,
    }
    await getJobQueue().send(METHODIST_RUN_QUEUE, jobPayload)

    res.status(202).json(run)
  })
)

// GET /api/methodist/runs/:id — poll run status / fetch the finished result.
router.get(
  '/runs/:id',
  validate(methodistRunIdRules),
  asyncHandler(async (req, res) => {
    const run = await getMethodistRun(req.params.id, req.teacher.id)
    if (!run) throw new NotFoundError('Проверка')
    res.json(run)
  })
)

// GET /api/methodist/runs — recent run history for this teacher.
router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json(await listRecentMethodistRuns(req.teacher.id))
  })
)

// GET /api/methodist/queue — Кабинет методиста (TODO Feature AM, Phase 3).
// Cross-programme triage: every discipline across every programme this role
// can see, institution-wide, with its РПД/review status — so a методист can
// find what needs attention instead of checking one discipline at a time.
// Reuses services/umcDashboard.ts's aggregation (Feature V) wholesale — same
// underlying signals, same shape — but under a DIFFERENT gate:
// `methodist_access` (curriculum domain, admin_office unit type), not
// `umu_access`. Deliberately NOT a change to routes/umcDashboard.ts's own
// gate — docs/ACCESS-MATRIX.md documents "Готовность УМК строго УМУ + РУМЦ"
// as a deliberate exclusion (a plain РОП must never reach it); widening
// THAT gate would break that invariant. This is a separate screen for a
// different audience (adds МУМЦ) reading the same data, not a widened gate
// on the existing one.
router.get(
  '/queue',
  requireDomainOnUnitTypes('curriculum', 'view', METHODIST_UNIT_TYPES),
  asyncHandler(async (req, res) => {
    const prefixes = await resolveMethodistPrefixes(req)
    res.json(await getUmcDashboard(institutionId(req), prefixes))
  })
)

// POST /api/methodist/ad-hoc-review — Кабинет методиста (TODO Feature AM,
// Phase 3). §5-§8 evidence-citation coverage check for a РПД that isn't
// attached to any programme yet — a file received by email, or one still
// being drafted outside the system. Accepts either an uploaded file (PDF/
// Word/image — same MIME allowlist as every other upload path) or pasted
// text. Reuses services/syllabusReview.ts's reviewSyllabus directly, exactly
// as routes/curriculum.ts's syllabus-review does for the raw-text case — no
// competencies/goals are passed, so the parser extracts them from the
// document's own declared sections (competencies_source: 'declared').
// Nothing is persisted: there's no programme/discipline to key a result
// row to, and syllabus-review has never had a dedicated results table (see
// checks.ts's header comment) — this is the same "no home for it" case,
// just without even a run row, since a single check with no target has
// nothing worth polling for.
router.post(
  '/ad-hoc-review',
  aiLimiter,
  requireDomainOnUnitTypes('curriculum', 'view', METHODIST_UNIT_TYPES),
  uploadConfig.single('file'),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    let text = typeof req.body?.syllabus_text === 'string' ? req.body.syllabus_text.trim() : ''

    if (req.file) {
      const extracted = await extractText(req.file.buffer, req.file.mimetype)
      text = extracted.text
    }
    if (!text) throw new ValidationError('Загрузите файл или вставьте текст РПД.')

    const review = await reviewSyllabus({ teacherId: req.teacher.id, syllabusText: text })
    res.json(review)
  })
)

export default router
