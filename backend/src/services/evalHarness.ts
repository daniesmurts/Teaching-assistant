// Eval harness — offline replay for the flywheel experiment.
//
// For each approved assignment (chronological order), re-grade it through the
// production prompt path (gradeOnce) under controlled conditions: K = number
// of RAG examples injected, retrieved ONLY from assignments approved before
// the target existed (no future leakage). Results land in eval_results next
// to the teacher's ground-truth score; summariseRun() computes the
// agreement-vs-K table that is the core artefact of the flywheel study.
//
// This module never touches production tables beyond reads. Safe to run
// against live data; cost is ~N_assignments × N_conditions grading calls.

import { gradeOnce } from './grading'
import { gradeEnsemble } from './confidence'
import { embed } from './deepseek'
import {
  findReplayTargets,
  findSimilarAssignmentsBefore,
  findContrastingAssignmentBefore,
  type ReplayTarget,
  type SimilarAssignment,
} from '../db/queries/assignments'
import { getPolicyMemo } from '../db/queries/policyMemos'
import {
  createEvalRun, getEvalRun, completeEvalRun,
  findCompletedConditions, insertEvalResult, findEvalResults,
  insertConfidenceResult, findConfidenceResults, findCompletedConfidenceIds,
} from '../db/queries/evalRuns'
import { quadraticWeightedKappa, meanAbsoluteError, spearman } from '../lib/evalMetrics'
import {
  riskCoverageCurve, binnedCalibration, selectivityGain, fitThresholds,
  type ConfidencePair, type CoveragePoint, type CalibrationBin, type FittedThresholds,
} from '../lib/confidenceCalibration'
import { upsertConfidenceConfig } from '../db/queries/confidenceConfig'
import { invalidateThresholdsCache } from './confidence'
import { logger } from '../lib/logger'
import type { CriteriaSnapshotItem } from '../../../shared/types'

const DEFAULT_CONDITIONS = [0, 3, 5]
const CONCURRENCY = 2          // parallel grading calls — gentle on rate limits

// Which retrieval/prompt refinements to A/B against the baseline top-K
// examples. 'contrastive' adds a grade-contrasting neighbour when the K
// examples are grade-homogeneous; 'policyMemo' injects the course's
// distilled correction memo; 'both' does both. Only meaningful for k > 0
// (k=0 has no examples to contrast, but policyMemo still applies).
export type ReplayVariant = 'baseline' | 'contrastive' | 'policyMemo' | 'both'
const DEFAULT_VARIANTS: ReplayVariant[] = ['baseline']

export interface ReplayConfig {
  teacherId:   string
  courseId?:   string
  conditions?: number[]
  variants?:   ReplayVariant[]
  limit?:      number          // cap on assignments (newest dropped), for cheap pilots
  resumeRunId?: string
  notes?:      string
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen'
}

export interface ReplayProgress {
  runId:     string
  total:     number            // (assignment, K) pairs in scope
  done:      number
  skipped:   number            // already present from a previous (resumed) run
  failed:    number
}

/**
 * Strip the merged-in AI scores from a stored criteria snapshot so the replay
 * grades against clean criteria definitions, exactly like the original call.
 */
export function cleanSnapshotForReplay(
  snapshot: CriteriaSnapshotItem[] | null
): CriteriaSnapshotItem[] {
  if (!snapshot) return []
  return snapshot.map(({ criterion_id, name, weight, description }) => ({
    criterion_id, name, weight, description,
  }))
}

export async function runReplay(
  cfg: ReplayConfig,
  onProgress?: (p: ReplayProgress) => void
): Promise<ReplayProgress> {
  const conditions = cfg.conditions ?? DEFAULT_CONDITIONS
  const variants    = cfg.variants ?? DEFAULT_VARIANTS

  // Create or resume the run
  let runId: string
  if (cfg.resumeRunId) {
    const existing = await getEvalRun(cfg.resumeRunId)
    if (!existing) throw new Error(`Eval run not found: ${cfg.resumeRunId}`)
    runId = existing.id
  } else {
    const run = await createEvalRun({
      teacherId:  cfg.teacherId,
      courseId:   cfg.courseId,
      model:      'deepseek-chat',
      conditions,
      notes:      cfg.notes,
    })
    runId = run.id
  }

  const alreadyDone = await findCompletedConditions(runId)

  let targets = await findReplayTargets(cfg.teacherId, cfg.courseId)
  if (cfg.limit && targets.length > cfg.limit) targets = targets.slice(0, cfg.limit)

  // Empty replay set is its own outcome — flag it with a useful reason so the
  // admin sees *why* instead of an opaque "ошибка". `findReplayTargets`
  // requires status=approved + course_id IS NOT NULL, which is the usual
  // reason it comes back empty for a fresh teacher.
  if (targets.length === 0) {
    await completeEvalRun(
      runId,
      'failed',
      'Нет утверждённых работ с привязкой к предмету — нечего воспроизводить.',
    )
    return { runId, total: 0, done: 0, skipped: 0, failed: 0 }
  }

  const progress: ReplayProgress = {
    runId,
    total:   targets.length * conditions.length * variants.length,
    done:    0,
    skipped: 0,
    failed:  0,
  }

  // Work queue of (target, K, variant) triples, processed with bounded concurrency.
  const queue: Array<{ target: ReplayTarget; k: number; variant: ReplayVariant }> = []
  for (const target of targets) {
    for (const k of conditions) {
      for (const variant of variants) {
        if (alreadyDone.has(`${target.id}:${k}:${variant}`)) {
          progress.skipped += 1
          progress.done    += 1
        } else {
          queue.push({ target, k, variant })
        }
      }
    }
  }

  // Policy memos are per-course, not per-target — cache lookups across the queue.
  const memoCache = new Map<string, string | null>()
  async function courseMemo(courseId: string): Promise<string | null> {
    if (memoCache.has(courseId)) return memoCache.get(courseId)!
    const memo = await getPolicyMemo(courseId)
    const text = memo?.memo_text ?? null
    memoCache.set(courseId, text)
    return text
  }

  // Per-target embedding cache (each target appears once per condition).
  const embeddingCache = new Map<string, number[]>()

  async function targetEmbedding(t: ReplayTarget): Promise<number[]> {
    const cached = embeddingCache.get(t.id)
    if (cached) return cached
    let vector: number[]
    if (t.embedding_str) {
      vector = JSON.parse(t.embedding_str) as number[]   // pgvector text form is valid JSON
    } else {
      vector = await embed(t.submission_text, { teacherId: cfg.teacherId, feature: 'embedding' })
    }
    embeddingCache.set(t.id, vector)
    return vector
  }

  async function processOne(item: { target: ReplayTarget; k: number; variant: ReplayVariant }): Promise<void> {
    const { target, k, variant } = item
    const started = Date.now()
    try {
      let examples: SimilarAssignment[] = []
      if (k > 0) {
        const vector = await targetEmbedding(target)
        examples = await findSimilarAssignmentsBefore(
          target.course_id, vector, target.created_at, target.id, k,
        )

        if (variant === 'contrastive' || variant === 'both') {
          const uniqueGrades = new Set(examples.map((e) => e.approved_grade))
          if (examples.length > 0 && uniqueGrades.size === 1) {
            const contrast = await findContrastingAssignmentBefore(
              target.course_id, vector, target.created_at,
              examples.map((e) => e.id), [...uniqueGrades],
            )
            if (contrast) examples = [...examples, contrast]
          }
        }
      }

      const policyMemo = (variant === 'policyMemo' || variant === 'both')
        ? await courseMemo(target.course_id)
        : null

      const result = await gradeOnce({
        submissionText:   target.submission_text,
        criteria:         cleanSnapshotForReplay(target.criteria_snapshot),
        examples,
        policyMemo,
        context:          { teacherId: cfg.teacherId, feature: 'grading' },
        providerOverride: cfg.providerOverride,
      })

      await insertEvalResult({
        runId,
        assignmentId:   target.id,
        k,
        variant,
        examplesUsed:   examples.length,
        replayScore:    result.score,
        replayGrade:    result.grade,
        replayCriteria: result.criteriaScores,
        teacherScore:   target.approved_score,
        teacherGrade:   target.approved_grade,
        durationMs:     Date.now() - started,
      })
    } catch (err) {
      progress.failed += 1
      await insertEvalResult({
        runId,
        assignmentId:   target.id,
        k,
        variant,
        examplesUsed:   0,
        replayScore:    null,
        replayGrade:    null,
        replayCriteria: null,
        teacherScore:   target.approved_score,
        teacherGrade:   target.approved_grade,
        durationMs:     Date.now() - started,
        error:          (err as Error).message.slice(0, 500),
      }).catch(() => null)
      logger.warn({ message: '[eval] condition failed', assignment: target.id, k, variant, error: (err as Error).message })
    } finally {
      progress.done += 1
      onProgress?.(progress)
    }
  }

  // Bounded-concurrency worker pool
  let next = 0
  async function worker(): Promise<void> {
    while (next < queue.length) {
      const i = next++
      await processOne(queue[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  await completeEvalRun(runId, progress.failed === progress.total ? 'failed' : 'done')
  return progress
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface ConditionSummary {
  k:             number
  variant:       string
  n:             number          // usable result pairs
  meanExamples:  number          // actual examples injected (may be < k on thin data)
  qwk:           number | null   // on 5-point grade
  mae:           number | null   // on 0–100 score
  rho:           number | null   // Spearman on 0–100 score
}

export async function summariseRun(runId: string): Promise<ConditionSummary[]> {
  const rows = await findEvalResults(runId)
  const byKV = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.error || r.replay_score == null || r.replay_grade == null) continue
    const key = `${r.k}:${r.variant}`
    if (!byKV.has(key)) byKV.set(key, [])
    byKV.get(key)!.push(r)
  }

  const out: ConditionSummary[] = []
  for (const group of Array.from(byKV.values()).sort((a, b) => a[0].k - b[0].k || a[0].variant.localeCompare(b[0].variant))) {
    const replayScores  = group.map((r) => r.replay_score!)
    const teacherScores = group.map((r) => r.teacher_score)
    const replayGrades  = group.map((r) => parseInt(r.replay_grade!, 10))
    const teacherGrades = group.map((r) => parseInt(r.teacher_grade, 10))

    out.push({
      k:            group[0].k,
      variant:      group[0].variant,
      n:            group.length,
      meanExamples: group.reduce((s, r) => s + r.examples_used, 0) / group.length,
      qwk:          group.length >= 2 ? round3(quadraticWeightedKappa(teacherGrades, replayGrades)) : null,
      mae:          round3(meanAbsoluteError(teacherScores, replayScores)),
      rho:          group.length >= 2 ? round3(spearman(teacherScores, replayScores)) : null,
    })
  }
  return out
}

/** Raw per-condition rows as CSV — the dataset behind the paper's chart. */
export async function exportRunCsv(runId: string): Promise<string> {
  const rows = await findEvalResults(runId)
  const header = 'assignment_id,k,variant,examples_used,replay_score,replay_grade,teacher_score,teacher_grade,error'
  const body = rows.map((r) => [
    r.assignment_id, r.k, r.variant, r.examples_used,
    r.replay_score ?? '', r.replay_grade ?? '',
    r.teacher_score, r.teacher_grade,
    r.error ? `"${r.error.replace(/"/g, '""')}"` : '',
  ].join(','))
  return [header, ...body].join('\n')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ─── Confidence replay (risk-coverage study) ───────────────────────────────────
//
// Runs the grader ensemble over each approved assignment (with the same
// time-respecting K examples production would use), records dispersion + error
// vs teacher ground truth, then builds the risk-coverage curve. The headline
// claim: keeping only the most-confident X% of grades sharply lowers the mean
// error — i.e. the system knows when to defer to the teacher.

export interface ConfidenceReplayConfig {
  teacherId:    string
  courseId?:    string
  k?:           number   // RAG examples per ensemble (production default 5)
  samples?:     number   // ensemble size (default 3)
  limit?:       number
  resumeRunId?: string
  notes?:       string
}

export async function runConfidenceReplay(
  cfg: ConfidenceReplayConfig,
  onProgress?: (p: { runId: string; done: number; total: number; failed: number }) => void,
): Promise<{ runId: string; done: number; total: number; failed: number }> {
  const k = cfg.k ?? 5

  let runId: string
  if (cfg.resumeRunId) {
    const existing = await getEvalRun(cfg.resumeRunId)
    if (!existing) throw new Error(`Eval run not found: ${cfg.resumeRunId}`)
    runId = existing.id
  } else {
    const run = await createEvalRun({
      teacherId: cfg.teacherId, courseId: cfg.courseId,
      model: 'deepseek-chat', conditions: [k], kind: 'confidence', notes: cfg.notes,
    })
    runId = run.id
  }

  const done = await findCompletedConfidenceIds(runId)
  let targets = await findReplayTargets(cfg.teacherId, cfg.courseId)
  if (cfg.limit && targets.length > cfg.limit) targets = targets.slice(0, cfg.limit)

  if (targets.length === 0) {
    await completeEvalRun(
      runId,
      'failed',
      'Нет утверждённых работ с привязкой к предмету — нечего воспроизводить.',
    )
    return { runId, total: 0, done: 0, failed: 0 }
  }

  const progress = { runId, total: targets.length, done: 0, failed: 0 }

  for (const target of targets) {
    if (done.has(target.id)) { progress.done += 1; onProgress?.(progress); continue }
    const started = Date.now()
    try {
      // Time-respecting examples — same retrieval production would have used.
      let examples: SimilarAssignment[] = []
      if (k > 0) {
        const vector = target.embedding_str
          ? (JSON.parse(target.embedding_str) as number[])
          : await embed(target.submission_text, { teacherId: cfg.teacherId, feature: 'embedding' })
        examples = await findSimilarAssignmentsBefore(target.course_id, vector, target.created_at, target.id, k)
      }

      const outcome = await gradeEnsemble(
        {
          submissionText: target.submission_text,
          criteria:       cleanSnapshotForReplay(target.criteria_snapshot),
          examples,
          context:        { teacherId: cfg.teacherId, feature: 'grading' },
        },
        { samples: cfg.samples ?? 3 },
      )

      await insertConfidenceResult({
        runId,
        assignmentId:   target.id,
        consensusScore: outcome.primary.score,
        consensusGrade: outcome.primary.grade,
        scoreStd:       outcome.ensemble.score_std,
        gradeAgreement: outcome.ensemble.grade_agreement,
        confidence:     outcome.confidence,
        teacherScore:   target.approved_score,
        teacherGrade:   target.approved_grade,
        samples:        outcome.ensemble.samples,
        durationMs:     Date.now() - started,
      })
    } catch (err) {
      progress.failed += 1
      await insertConfidenceResult({
        runId, assignmentId: target.id,
        consensusScore: null, consensusGrade: null, scoreStd: null,
        gradeAgreement: null, confidence: null,
        teacherScore: target.approved_score, teacherGrade: target.approved_grade,
        samples: null, durationMs: Date.now() - started,
        error: (err as Error).message.slice(0, 500),
      }).catch(() => null)
      logger.warn({ message: '[confidence-eval] failed', assignment: target.id, error: (err as Error).message })
    } finally {
      progress.done += 1
      onProgress?.(progress)
    }
  }

  await completeEvalRun(runId, progress.failed === progress.total ? 'failed' : 'done')
  return progress
}

export interface ConfidenceSummary {
  n:            number
  riskCoverage: CoveragePoint[]
  calibration:  CalibrationBin[]
  selectivity:  number   // mean-error gap between least- and most-confident terciles
  byLabel: Array<{ confidence: string; n: number; meanError: number; gradeAccuracy: number }>
}

export async function summariseConfidence(runId: string): Promise<ConfidenceSummary> {
  const rows = await findConfidenceResults(runId)
  const usable = rows.filter(
    (r) => !r.error && r.consensus_score != null && r.score_std != null && r.consensus_grade != null,
  )

  const pairs: ConfidencePair[] = usable.map((r) => ({
    signal:     Number(r.score_std),
    scoreError: Math.abs(r.consensus_score! - r.teacher_score),
    gradeMatch: r.consensus_grade === r.teacher_grade,
  }))

  // Per-label (high/medium/low) aggregates, for the product UI's framing.
  const labels = ['high', 'medium', 'low']
  const byLabel = labels.map((label) => {
    const group = usable.filter((r) => r.confidence === label)
    const errs = group.map((r) => Math.abs(r.consensus_score! - r.teacher_score))
    const matches = group.filter((r) => r.consensus_grade === r.teacher_grade).length
    return {
      confidence:    label,
      n:             group.length,
      meanError:     group.length ? round2(errs.reduce((a, b) => a + b, 0) / group.length) : 0,
      gradeAccuracy: group.length ? round3(matches / group.length) : 0,
    }
  }).filter((x) => x.n > 0)

  return {
    n:            pairs.length,
    riskCoverage: riskCoverageCurve(pairs),
    calibration:  binnedCalibration(pairs, 3),
    selectivity:  selectivityGain(pairs),
    byLabel,
  }
}

// ─── Fit + persist thresholds from a confidence run ────────────────────────────

/**
 * Read a confidence run's results, fit data-driven dispersion thresholds against
 * teacher ground truth, persist them, and bust the in-memory cache so the next
 * grade uses the new values. Returns null when there isn't enough usable data.
 */
export async function fitThresholdsForRun(
  runId: string,
  targets?: { highTargetError: number; lowTargetError: number },
): Promise<FittedThresholds | null> {
  const rows = await findConfidenceResults(runId)
  const pairs: ConfidencePair[] = rows
    .filter((r) => !r.error && r.consensus_score != null && r.score_std != null && r.consensus_grade != null)
    .map((r) => ({
      signal:     Number(r.score_std),
      scoreError: Math.abs(r.consensus_score! - r.teacher_score),
      gradeMatch: r.consensus_grade === r.teacher_grade,
    }))

  const fit = fitThresholds(pairs, targets)
  if (!fit) return null

  await upsertConfidenceConfig({
    highStdMax: fit.highStdMax,
    lowStdMin:  fit.lowStdMin,
    runId,
    nHigh:      fit.nHigh,
    nLow:       fit.nLow,
  })
  invalidateThresholdsCache()
  return fit
}
