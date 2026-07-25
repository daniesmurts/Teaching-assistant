// Per-scope score calibration (Research §10.1 / TODO Feature AF).
//
// A single LLM grade is trusted raw today (grading.ts's clampScore). But each
// teacher runs systematically hot or cold, and each course has its own grade
// distribution — exactly the bias MAE/QWK punish. approved_revisions already
// pairs every AI score with the teacher's final approved score over time; fit
// a monotonic map from raw → calibrated score off that history and apply it
// as a pure post-processing step. Pure functions, fully unit-tested; no I/O —
// the DB-facing half (fetching pairs, caching the active map) lives in
// services/scoreCalibration.ts.
//
// validateCalibrationSplit (below) is the harness-side proof that the map
// generalises rather than memorising: fit on the chronologically-earlier
// slice only, score MAE/Spearman on the later slice the fit never saw — the
// same "no future leakage" posture evalHarness.ts already uses for RAG
// replay (findSimilarAssignmentsBefore). No LLM calls needed here — unlike
// the flywheel/confidence replays, calibration only ever operates on scores
// already sitting in `assignments`, so validating it is pure arithmetic.

import { meanAbsoluteError, spearman } from './evalMetrics'

export interface CalibrationPair {
  aiScore:      number   // 0–100, the raw model score at grading time
  teacherScore: number   // 0–100, the teacher's final approved score
}

export interface CalibrationPoint {
  x: number   // raw AI score (pooled group mean when PAVA merges blocks)
  y: number   // calibrated score for that raw value
}

const DEFAULT_MIN_SAMPLES = 20

interface Block { xSum: number; ySum: number; weight: number }

/**
 * Fit a monotonic (isotonic) calibration map via Pool Adjacent Violators.
 * Returns null when there isn't enough history to fit responsibly — callers
 * must treat null as "pass raw score through unchanged," never as zero
 * correction.
 */
export function fitIsotonicCalibration(
  pairs: CalibrationPair[],
  minSamples: number = DEFAULT_MIN_SAMPLES,
): CalibrationPoint[] | null {
  if (pairs.length < minSamples) return null

  // Group identical raw scores into one weighted point first — PAVA expects
  // a strictly increasing x sequence going in.
  const sorted = [...pairs].sort((a, b) => a.aiScore - b.aiScore)
  const grouped: Block[] = []
  for (const p of sorted) {
    const last = grouped[grouped.length - 1]
    if (last && last.xSum / last.weight === p.aiScore) {
      last.xSum += p.aiScore
      last.ySum += p.teacherScore
      last.weight += 1
    } else {
      grouped.push({ xSum: p.aiScore, ySum: p.teacherScore, weight: 1 })
    }
  }

  // Pool Adjacent Violators — merge backwards whenever the running mean would
  // otherwise decrease, producing a monotone non-decreasing step function.
  const stack: Block[] = []
  for (const b of grouped) {
    stack.push({ ...b })
    while (
      stack.length > 1 &&
      stack[stack.length - 2].ySum / stack[stack.length - 2].weight >
        stack[stack.length - 1].ySum / stack[stack.length - 1].weight
    ) {
      const top = stack.pop()!
      const prev = stack.pop()!
      stack.push({ xSum: prev.xSum + top.xSum, ySum: prev.ySum + top.ySum, weight: prev.weight + top.weight })
    }
  }

  // A single pooled block (e.g. every raw score collapsed together) carries
  // no usable shape — treat like "not enough signal" rather than applying a
  // blanket constant.
  if (stack.length < 2) return null

  return stack.map((b) => ({ x: round2(b.xSum / b.weight), y: round2(b.ySum / b.weight) }))
}

/**
 * Apply a fitted calibration map to a raw score via piecewise-linear
 * interpolation between breakpoints. Extrapolates FLAT beyond the fitted
 * domain (isotonic regression gives no evidence outside the range it was
 * trained on) rather than linearly projecting past it. Passes the raw score
 * through unchanged when there is no map yet.
 */
export function applyCalibration(rawScore: number, points: CalibrationPoint[] | null): number {
  if (!points || points.length < 2) return clampScore(rawScore)
  if (rawScore <= points[0].x) return clampScore(points[0].y)
  if (rawScore >= points[points.length - 1].x) return clampScore(points[points.length - 1].y)

  for (let i = 1; i < points.length; i++) {
    if (rawScore <= points[i].x) {
      const a = points[i - 1]
      const b = points[i]
      if (b.x === a.x) return clampScore(a.y)
      const t = (rawScore - a.x) / (b.x - a.x)
      return clampScore(a.y + t * (b.y - a.y))
    }
  }
  return clampScore(rawScore)
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Leakage-safe validation ────────────────────────────────────────────────

export interface TimestampedCalibrationPair extends CalibrationPair {
  createdAt: number   // epoch ms — only used to order the chronological split
}

export interface CalibrationMetrics {
  mae: number
  rho: number | null   // null when fewer than 2 test pairs (spearman undefined)
}

export interface CalibrationValidationResult {
  nTrain: number
  nTest:  number
  baseline:   CalibrationMetrics   // raw AI score vs teacher score, on the test slice
  calibrated: CalibrationMetrics   // calibrated score vs teacher score, on the SAME test slice
  maeImprovementPct: number        // (baseline.mae − calibrated.mae) / baseline.mae × 100; negative = calibration hurt
  points: CalibrationPoint[]       // the map fitted on the train slice only
}

export interface ValidationOptions {
  trainFraction?: number   // fraction of (chronologically earliest) pairs used to fit; default 0.7
  minTrain?:      number   // minimum train-slice size to attempt a fit; default 20
  minTest?:       number   // minimum held-out size to trust the reported metrics; default 5
}

const DEFAULT_TRAIN_FRACTION = 0.7
const DEFAULT_MIN_TRAIN = 20
const DEFAULT_MIN_TEST  = 5

/**
 * Fit on the earliest `trainFraction` of pairs (by createdAt), evaluate on
 * the rest. This is the proof that calibration would have actually helped
 * grades issued AFTER the fit — not just a same-data-fit-and-score exercise,
 * which would silently permit the map to memorise rather than generalise.
 * Returns null when either slice is too small to trust.
 */
export function validateCalibrationSplit(
  pairs: TimestampedCalibrationPair[],
  opts: ValidationOptions = {},
): CalibrationValidationResult | null {
  const trainFraction = opts.trainFraction ?? DEFAULT_TRAIN_FRACTION
  const minTrain = opts.minTrain ?? DEFAULT_MIN_TRAIN
  const minTest  = opts.minTest  ?? DEFAULT_MIN_TEST

  const sorted = [...pairs].sort((a, b) => a.createdAt - b.createdAt)
  const splitIdx = Math.floor(sorted.length * trainFraction)
  const train = sorted.slice(0, splitIdx)
  const test  = sorted.slice(splitIdx)

  if (train.length < minTrain || test.length < minTest) return null

  const points = fitIsotonicCalibration(train, minTrain)
  if (!points) return null

  const teacherScores    = test.map((p) => p.teacherScore)
  const rawScores        = test.map((p) => p.aiScore)
  const calibratedScores = test.map((p) => applyCalibration(p.aiScore, points))

  const baselineMae   = meanAbsoluteError(teacherScores, rawScores)
  const calibratedMae = meanAbsoluteError(teacherScores, calibratedScores)

  return {
    nTrain: train.length,
    nTest:  test.length,
    baseline:   { mae: round2(baselineMae),   rho: safeSpearman(teacherScores, rawScores) },
    calibrated: { mae: round2(calibratedMae), rho: safeSpearman(teacherScores, calibratedScores) },
    maeImprovementPct: baselineMae > 0 ? round2(((baselineMae - calibratedMae) / baselineMae) * 100) : 0,
    points,
  }
}

function safeSpearman(a: number[], b: number[]): number | null {
  return a.length >= 2 ? round2(spearman(a, b)) : null
}
