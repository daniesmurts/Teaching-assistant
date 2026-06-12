// Calibration + risk-coverage analysis for the confidence ensemble.
//
// Research artefact (ФСИ задел): turns raw ensemble dispersion into evidence
// that the system "knows when it doesn't know." The risk-coverage curve is the
// headline result — keep only the most-confident X% of grades and measure how
// much agreement with the teacher improves on that subset (selective
// prediction). Pure functions, fully unit-tested; no I/O.

export interface ConfidencePair {
  /** Uncertainty signal — LOWER means MORE confident (e.g. ensemble score std). */
  signal:      number
  /** Absolute score error vs teacher ground truth (|consensus − teacher|, 0–100). */
  scoreError:  number
  /** Whether the consensus grade matched the teacher's grade. */
  gradeMatch:  boolean
}

export interface CoveragePoint {
  coverage:      number   // fraction of works retained (0–1)
  n:             number   // works in this subset
  meanError:     number   // mean |consensus − teacher| on the subset (the "risk")
  gradeAccuracy: number   // fraction of grade matches on the subset
  signalMax:     number   // the dispersion threshold at this coverage
}

/**
 * Risk-coverage curve. Sort by confidence (ascending signal = most confident
 * first); at each coverage level keep the top fraction and report the risk
 * (mean error) + grade accuracy on that retained subset.
 *
 * A working confidence estimator produces a MONOTONICALLY DECREASING meanError
 * as coverage shrinks — that's the publishable claim.
 */
export function riskCoverageCurve(
  pairs: ConfidencePair[],
  coverageLevels: number[] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3],
): CoveragePoint[] {
  if (pairs.length === 0) return []

  const sorted = [...pairs].sort((a, b) => a.signal - b.signal)
  const out: CoveragePoint[] = []

  for (const coverage of coverageLevels) {
    const k = Math.max(1, Math.round(coverage * sorted.length))
    const subset = sorted.slice(0, k)
    const meanError = subset.reduce((s, p) => s + p.scoreError, 0) / k
    const gradeAccuracy = subset.filter((p) => p.gradeMatch).length / k
    out.push({
      coverage,
      n: k,
      meanError:     round2(meanError),
      gradeAccuracy: round3(gradeAccuracy),
      signalMax:     round2(subset[subset.length - 1].signal),
    })
  }
  return out
}

export interface CalibrationBin {
  bin:           number   // 0-indexed, ascending signal
  n:             number
  signalLow:     number
  signalHigh:    number
  meanError:     number
  gradeAccuracy: number
}

/**
 * Bin the (signal → error) relationship into quantile buckets. This is the map
 * that makes the heuristic confidence thresholds principled: it shows, per
 * dispersion band, the empirical error the teacher should expect.
 */
export function binnedCalibration(pairs: ConfidencePair[], bins = 3): CalibrationBin[] {
  if (pairs.length === 0) return []
  const sorted = [...pairs].sort((a, b) => a.signal - b.signal)
  const n = sorted.length
  const out: CalibrationBin[] = []

  for (let b = 0; b < bins; b++) {
    const start = Math.floor((b * n) / bins)
    const end   = Math.floor(((b + 1) * n) / bins)
    const slice = sorted.slice(start, end)
    if (slice.length === 0) continue
    out.push({
      bin:           b,
      n:             slice.length,
      signalLow:     round2(slice[0].signal),
      signalHigh:    round2(slice[slice.length - 1].signal),
      meanError:     round2(slice.reduce((s, p) => s + p.scoreError, 0) / slice.length),
      gradeAccuracy: round3(slice.filter((p) => p.gradeMatch).length / slice.length),
    })
  }
  return out
}

/**
 * Single-number summary of how well the signal separates good from bad grades:
 * the difference in mean error between the least- and most-confident terciles.
 * Positive and large = the signal is informative.
 */
export function selectivityGain(pairs: ConfidencePair[]): number {
  const bins = binnedCalibration(pairs, 3)
  if (bins.length < 2) return 0
  const mostConfident  = bins[0]
  const leastConfident = bins[bins.length - 1]
  return round2(leastConfident.meanError - mostConfident.meanError)
}

// ─── Threshold fitting ──────────────────────────────────────────────────────
//
// Turn the heuristic confidence thresholds (in confidence.ts) into data-driven
// ones: pick the dispersion cut-offs that best match target error bands on the
// teacher-labelled replay set.

export interface FittedThresholds {
  highStdMax: number   // std ≤ this → high confidence
  lowStdMin:  number   // std ≥ this → low confidence
  nHigh:      number   // works that would land in "high" at this cut
  nLow:       number
  highError:  number   // mean error of the resulting "high" subset
  lowError:   number   // mean error of the resulting "low" subset
}

export interface FitTargets {
  highTargetError: number   // high-confidence subset should average ≤ this error
  lowTargetError:  number   // low-confidence subset should average ≥ this error
}

const DEFAULT_TARGETS: FitTargets = { highTargetError: 6, lowTargetError: 12 }

/**
 * Fit dispersion thresholds against ground truth.
 *  - highStdMax = the LARGEST std cut such that {std ≤ cut} averages ≤
 *    highTargetError (the confident subset is genuinely accurate)
 *  - lowStdMin  = the SMALLEST std cut such that {std ≥ cut} averages ≥
 *    lowTargetError (the flagged subset is genuinely unreliable)
 * Returns null when there isn't enough data to fit (caller keeps defaults).
 */
export function fitThresholds(
  pairs: ConfidencePair[],
  targets: FitTargets = DEFAULT_TARGETS,
): FittedThresholds | null {
  if (pairs.length < 4) return null
  const sorted = [...pairs].sort((a, b) => a.signal - b.signal)

  // highStdMax: extend the confident subset from the smallest std upward while
  // its running mean error stays within the high target.
  let highStdMax = 0
  let sum = 0
  let count = 0
  for (const p of sorted) {
    const nextMean = (sum + p.scoreError) / (count + 1)
    if (nextMean <= targets.highTargetError) {
      sum += p.scoreError
      count += 1
      highStdMax = p.signal
    } else {
      break
    }
  }

  // lowStdMin: extend the flagged subset from the largest std downward while
  // its running mean error stays at/above the low target.
  let lowStdMin = Infinity
  let lowSum = 0
  let lowCount = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    const nextMean = (lowSum + p.scoreError) / (lowCount + 1)
    if (nextMean >= targets.lowTargetError) {
      lowSum += p.scoreError
      lowCount += 1
      lowStdMin = p.signal
    } else {
      break
    }
  }

  // Degenerate fits: nothing qualified as high, or nothing as low.
  if (count === 0) highStdMax = 0
  if (lowCount === 0) lowStdMin = Math.max(highStdMax, sorted[sorted.length - 1].signal) + 1

  // Keep the bands ordered — if they cross, snap lowStdMin above highStdMax.
  if (lowStdMin <= highStdMax) lowStdMin = highStdMax + 0.01

  return {
    highStdMax: round2(highStdMax),
    lowStdMin:  round2(lowStdMin),
    nHigh:      count,
    nLow:       lowCount,
    highError:  count ? round2(sum / count) : 0,
    lowError:   lowCount ? round2(lowSum / lowCount) : 0,
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function round3(n: number): number { return Math.round(n * 1000) / 1000 }
