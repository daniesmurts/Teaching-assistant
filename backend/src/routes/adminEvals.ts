import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  listEvalRuns, getEvalRun, createEvalRun,
} from '../db/queries/evalRuns'
import {
  runReplay, runConfidenceReplay, summariseRun, summariseConfidence,
  exportRunCsv, fitThresholdsForRun,
} from '../services/evalHarness'
import { getConfidenceConfig } from '../db/queries/confidenceConfig'
import { getCalibration } from '../db/queries/scoreCalibration'
import { fitCalibration, validateCalibration, type CalibrationScopeType } from '../services/scoreCalibration'
import { findReplayTargets } from '../db/queries/assignments'
import { logger } from '../lib/logger'

// Admin-only control surface for the eval harness (flywheel + confidence).
// Runs execute in the background (minutes); the UI polls run status.
const router = Router()
router.use(authenticate)
router.use(requireAdmin)

// GET /api/admin/evals — list past runs
router.get('/', asyncHandler(async (_req, res) => {
  res.json(await listEvalRuns(100))
}))

// GET /api/admin/evals/config — current calibrated thresholds (or null)
router.get('/config', asyncHandler(async (_req, res) => {
  res.json(await getConfidenceConfig())
}))

const VALID_CALIBRATION_SCOPES: CalibrationScopeType[] = ['course', 'teacher', 'institution']

// GET /api/admin/evals/calibration?scope_type=course&scope_id=... — fitted
// score-calibration map for one scope (or null). Registered ahead of GET
// /:id so "calibration" isn't swallowed as an eval-run id.
router.get('/calibration', asyncHandler(async (req, res) => {
  const scopeType = req.query.scope_type as string
  const scopeId   = req.query.scope_id as string
  if (!VALID_CALIBRATION_SCOPES.includes(scopeType as CalibrationScopeType) || !scopeId) {
    throw new ValidationError('Укажите scope_type (course|teacher|institution) и scope_id')
  }
  res.json(await getCalibration(scopeType as CalibrationScopeType, scopeId))
}))

// POST /api/admin/evals/calibration/fit — fit + persist a calibration map
// from that scope's approved grading history (Research §10.1 / Feature AF).
router.post('/calibration/fit', asyncHandler(async (req, res) => {
  const { scope_type, scope_id, min_samples } = req.body as {
    scope_type?: string; scope_id?: string; min_samples?: number
  }
  if (!scope_type || !VALID_CALIBRATION_SCOPES.includes(scope_type as CalibrationScopeType) || !scope_id) {
    throw new ValidationError('Укажите scope_type (course|teacher|institution) и scope_id')
  }
  const fit = await fitCalibration(scope_type as CalibrationScopeType, scope_id, min_samples)
  if (!fit) throw new ValidationError('Недостаточно данных для калибровки — нужно больше подтверждённых работ')
  res.json(fit)
}))

// GET /api/admin/evals/calibration/validate?scope_type=&scope_id=&train_fraction=&min_train=&min_test=
// Read-only leakage-safe proof: fits on the chronologically-earlier slice of
// approved history, scores MAE/Spearman on the later slice the fit never
// saw, and reports baseline vs calibrated side by side. Never writes
// score_calibration — safe to call before deciding to fitCalibration() for
// real (Research §10.0's "prove it before it ships" gate).
router.get('/calibration/validate', asyncHandler(async (req, res) => {
  const scopeType = req.query.scope_type as string
  const scopeId   = req.query.scope_id as string
  if (!VALID_CALIBRATION_SCOPES.includes(scopeType as CalibrationScopeType) || !scopeId) {
    throw new ValidationError('Укажите scope_type (course|teacher|institution) и scope_id')
  }
  const trainFraction = req.query.train_fraction != null ? Number(req.query.train_fraction) : undefined
  const minTrain       = req.query.min_train != null ? Number(req.query.min_train) : undefined
  const minTest         = req.query.min_test != null ? Number(req.query.min_test) : undefined

  const result = await validateCalibration(scopeType as CalibrationScopeType, scopeId, {
    trainFraction, minTrain, minTest,
  })
  if (!result) {
    throw new ValidationError('Недостаточно данных для проверки — нужно больше подтверждённых работ (или другой train_fraction)')
  }
  res.json(result)
}))

const VALID_VARIANTS = ['baseline', 'contrastive', 'policyMemo', 'both'] as const

// POST /api/admin/evals — start a flywheel replay (background)
router.post('/', asyncHandler(async (req, res) => {
  const { teacher_id, course_id, k, variants, limit, notes, provider } = req.body as {
    teacher_id?: string; course_id?: string; k?: number[]; variants?: string[]
    limit?: number; notes?: string
    provider?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen'
  }
  if (!teacher_id) throw new ValidationError('Укажите преподавателя')
  const conditions = Array.isArray(k) && k.length ? k.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : [0, 3, 5]
  const replayVariants = Array.isArray(variants) && variants.length
    ? variants.filter((v): v is typeof VALID_VARIANTS[number] => (VALID_VARIANTS as readonly string[]).includes(v))
    : ['baseline'] as const
  const providerOverride = provider && ['deepseek', 'yandex', 'gigachat'].includes(provider) ? provider : undefined

  // Pre-check: reject with a clear message before creating a phantom run row.
  // (The harness has its own fallback in case the check is racy.)
  const targets = await findReplayTargets(teacher_id, course_id)
  if (targets.length === 0) {
    throw new ValidationError(
      'У этого преподавателя нет утверждённых работ с привязкой к предмету — нечего воспроизводить.'
    )
  }

  // Provider tag goes into notes so the eval-runs list visually distinguishes
  // comparison runs without needing a schema migration.
  const taggedNotes = providerOverride
    ? `[provider:${providerOverride}]${notes ? ` ${notes}` : ''}`
    : notes

  const run = await createEvalRun({
    teacherId: teacher_id, courseId: course_id,
    model:    providerOverride ? `${providerOverride}-chat` : 'deepseek-chat',
    conditions, notes: taggedNotes, kind: 'flywheel',
  })
  // Fire-and-forget — resume into the row we just created.
  runReplay({
    teacherId: teacher_id, courseId: course_id, conditions,
    variants: [...replayVariants], limit, resumeRunId: run.id, providerOverride,
  })
    .catch((err) => logger.error({ message: '[admin-eval] flywheel run failed', runId: run.id, error: err.message }))

  res.status(201).json(run)
}))

// POST /api/admin/evals/confidence — start a confidence replay (background)
router.post('/confidence', asyncHandler(async (req, res) => {
  const { teacher_id, course_id, k, samples, limit, notes } = req.body as {
    teacher_id?: string; course_id?: string; k?: number; samples?: number; limit?: number; notes?: string
  }
  if (!teacher_id) throw new ValidationError('Укажите преподавателя')
  const kVal = Number.isInteger(k) ? Number(k) : 5

  const targets = await findReplayTargets(teacher_id, course_id)
  if (targets.length === 0) {
    throw new ValidationError(
      'У этого преподавателя нет утверждённых работ с привязкой к предмету — нечего воспроизводить.'
    )
  }

  const run = await createEvalRun({
    teacherId: teacher_id, courseId: course_id, model: 'deepseek-chat',
    conditions: [kVal], notes, kind: 'confidence',
  })
  runConfidenceReplay({ teacherId: teacher_id, courseId: course_id, k: kVal, samples, limit, resumeRunId: run.id })
    .catch((err) => logger.error({ message: '[admin-eval] confidence run failed', runId: run.id, error: err.message }))

  res.status(201).json(run)
}))

// GET /api/admin/evals/:id — run + summary (shape depends on kind)
router.get('/:id', asyncHandler(async (req, res) => {
  const run = await getEvalRun(req.params.id)
  if (!run) throw new NotFoundError('Запуск')
  const summary = run.kind === 'confidence'
    ? { kind: 'confidence', ...(await summariseConfidence(run.id)) }
    : { kind: 'flywheel', conditions: await summariseRun(run.id) }
  res.json({ run, summary })
}))

// GET /api/admin/evals/:id/csv — raw flywheel rows
router.get('/:id/csv', asyncHandler(async (req, res) => {
  const run = await getEvalRun(req.params.id)
  if (!run) throw new NotFoundError('Запуск')
  if (run.kind !== 'flywheel') throw new ValidationError('CSV доступен только для flywheel-запусков')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="eval_${run.id}.csv"`)
  res.send(await exportRunCsv(run.id))
}))

// POST /api/admin/evals/:id/apply-thresholds — fit + persist from a confidence run
router.post('/:id/apply-thresholds', asyncHandler(async (req, res) => {
  const run = await getEvalRun(req.params.id)
  if (!run) throw new NotFoundError('Запуск')
  if (run.kind !== 'confidence') throw new ValidationError('Калибровка доступна только для confidence-запусков')

  const { high_target_error, low_target_error } = req.body as {
    high_target_error?: number; low_target_error?: number
  }
  const targets = (high_target_error != null && low_target_error != null)
    ? { highTargetError: Number(high_target_error), lowTargetError: Number(low_target_error) }
    : undefined

  const fit = await fitThresholdsForRun(run.id, targets)
  if (!fit) throw new ValidationError('Недостаточно данных для калибровки порогов')
  res.json(fit)
}))

export default router
