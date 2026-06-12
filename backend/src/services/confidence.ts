// Confidence estimation via grader ensemble.
//
// Research basis (ФСИ «Развитие-ИИ» задел): a single LLM grade gives no signal
// about its own reliability. By sampling an ensemble of grader variants
// (persona × temperature) and measuring their disagreement, we derive a
// confidence label that flags uncertain works for closer teacher review —
// selective prediction / triage. The dispersion→confidence thresholds here are
// heuristic; Phase 5 calibrates them against teacher ground truth.
//
// The pure functions (computeDispersion, classifyConfidence) carry the logic
// and are fully unit-tested; gradeEnsemble is the I/O orchestrator.

import { gradeOnce, scoreOnce, type GradeOnceParams, type GradeOnceResult } from './grading'
import { getConfidenceConfig } from '../db/queries/confidenceConfig'
import type { GradeLetter, ConfidenceLevel, EnsembleSample, AiEnsemble } from '../../../shared/types'

// ─── Pure: dispersion stats ────────────────────────────────────────────────────

export interface ConfidenceInput {
  score: number
  grade: GradeLetter
}

export interface DispersionStats {
  n:              number
  scoreMean:      number
  scoreStd:       number      // population std of the M scores
  scoreSpread:    number      // max − min
  modalGrade:     GradeLetter
  gradeAgreement: number      // fraction of samples equal to the modal grade
}

export function computeDispersion(samples: ConfidenceInput[]): DispersionStats {
  if (samples.length === 0) throw new Error('computeDispersion needs at least one sample')

  const scores = samples.map((s) => s.score)
  const n = scores.length
  const scoreMean = scores.reduce((a, b) => a + b, 0) / n
  const variance  = scores.reduce((a, s) => a + (s - scoreMean) ** 2, 0) / n
  const scoreStd  = Math.sqrt(variance)
  const scoreSpread = Math.max(...scores) - Math.min(...scores)

  // Modal grade — ties resolve to the higher grade (closer to the mean intent
  // of "best supported"). GradeLetter ordering: '5' > '4' > '3' > '2'.
  const counts = new Map<GradeLetter, number>()
  for (const s of samples) counts.set(s.grade, (counts.get(s.grade) ?? 0) + 1)
  let modalGrade: GradeLetter = samples[0].grade
  let best = 0
  for (const [grade, count] of counts) {
    if (count > best || (count === best && grade > modalGrade)) {
      best = count
      modalGrade = grade
    }
  }
  const gradeAgreement = best / n

  return {
    n,
    scoreMean:   round1(scoreMean),
    scoreStd:    round2(scoreStd),
    scoreSpread,
    modalGrade,
    gradeAgreement: round2(gradeAgreement),
  }
}

// ─── Pure: confidence classification ───────────────────────────────────────────

// Default thresholds — used until a calibration run fits data-driven ones.
export const DEFAULT_THRESHOLDS = { highStdMax: 5, lowStdMin: 12 }
const LOW_AGREE_MAX = 0.6  // grade vote split — not fit (grade agreement is categorical)

export interface ConfidenceThresholds {
  highStdMax: number
  lowStdMin:  number
}

export function classifyConfidence(
  stats: DispersionStats,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceLevel {
  // Single-sample ensembles can't disagree — treat as medium (we have no
  // dispersion evidence either way).
  if (stats.n < 2) return 'medium'

  const unanimousGrade = stats.gradeAgreement >= 0.999
  if (unanimousGrade && stats.scoreStd <= thresholds.highStdMax) return 'high'
  if (stats.gradeAgreement < LOW_AGREE_MAX || stats.scoreStd >= thresholds.lowStdMin) return 'low'
  return 'medium'
}

// ── Cached active thresholds ────────────────────────────────────────────────
// Loaded from confidence_config once and cached for 5 min so grading doesn't
// hit the DB on every call. invalidateThresholdsCache() runs after a fit.
let cache: { value: ConfidenceThresholds; at: number } | null = null
const TTL_MS = 5 * 60 * 1000

export async function getActiveThresholds(): Promise<ConfidenceThresholds> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const cfg = await getConfidenceConfig()
    const value = cfg ? { highStdMax: cfg.highStdMax, lowStdMin: cfg.lowStdMin } : DEFAULT_THRESHOLDS
    cache = { value, at: Date.now() }
    return value
  } catch {
    return DEFAULT_THRESHOLDS   // never let config loading block grading
  }
}

export function invalidateThresholdsCache(): void {
  cache = null
}

// ─── Orchestrator: gradeEnsemble ───────────────────────────────────────────────

export interface EnsembleConfig {
  samples?: number   // total grader variants incl. primary; clamped to [2, 5]
}

export interface EnsembleOutcome {
  primary:    GradeOnceResult   // full feedback (neutral persona)
  confidence: ConfidenceLevel
  ensemble:   AiEnsemble
}

// Persona/temperature schedule for the secondary (score-only) samples. The
// primary is always neutral; secondaries alternate strict/lenient at a raised
// temperature to surface genuine disagreement.
const SECONDARY_SCHEDULE: Array<{ persona: 'strict' | 'lenient'; temperature: number }> = [
  { persona: 'strict',  temperature: 0.8 },
  { persona: 'lenient', temperature: 0.8 },
  { persona: 'strict',  temperature: 0.4 },
  { persona: 'lenient', temperature: 0.4 },
]

export async function gradeEnsemble(
  base: GradeOnceParams,
  cfg: EnsembleConfig = {},
): Promise<EnsembleOutcome> {
  const total = Math.max(2, Math.min(5, cfg.samples ?? 3))
  const secondaryCount = total - 1

  // Primary: full feedback, neutral persona — this is the headline grade and
  // matches what normal grading would produce.
  const primaryPromise = gradeOnce({ ...base, persona: 'neutral' })

  // Secondaries: cheap score-only samples with persona/temperature variation.
  const secondaryPromises = SECONDARY_SCHEDULE.slice(0, secondaryCount).map((cfg2) =>
    scoreOnce({
      submissionText:    base.submissionText,
      criteria:          base.criteria,
      examples:          base.examples,
      assignmentType:    base.assignmentType,
      referenceSolution: base.referenceSolution,
      persona:           cfg2.persona,
      temperature:       cfg2.temperature,
      context:           base.context,
    }).then((r) => ({ ...r, ...cfg2 }))
     .catch(() => null),   // a failed sample drops out, doesn't sink the ensemble
  )

  const [primary, secondaries] = await Promise.all([
    primaryPromise,
    Promise.all(secondaryPromises),
  ])

  const samples: EnsembleSample[] = [
    { persona: 'neutral', temperature: null, score: primary.score, grade: primary.grade },
    ...secondaries
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => ({ persona: s.persona, temperature: s.temperature, score: s.score, grade: s.grade })),
  ]

  const stats = computeDispersion(samples)
  const confidence = classifyConfidence(stats, await getActiveThresholds())

  return {
    primary,
    confidence,
    ensemble: {
      samples,
      score_std:       stats.scoreStd,
      score_spread:    stats.scoreSpread,
      grade_agreement: stats.gradeAgreement,
    },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
