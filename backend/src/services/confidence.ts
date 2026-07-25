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

import { gradeOnce, scoreOnce, resolveGradeForScore, type GradeOnceParams, type GradeOnceResult } from './grading'
import { getConfidenceConfig } from '../db/queries/confidenceConfig'
import { chatJSON, type CallContext } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
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
//
// NOTE: any thresholds fitted before the ensemble information-symmetry fix
// (secondaries now receive the same policy memo, criteria descriptions and
// retrieved examples as the primary) were fitted against a dispersion
// distribution that included that asymmetry as noise, and read too wide.
// Re-run a confidence replay + apply-thresholds to refit against the current
// regime rather than trusting a stale confidence_config row.
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
//
// Same-model temperature/persona jitter under-reports uncertainty: when a
// model misreads the submission (wrong premise, an arithmetic step it's
// blind to), every sample tends to inherit the same misreading, and
// dispersion looks falsely low ("confidently wrong"). Routing every other
// secondary to Qwen via providerOverride decorrelates that failure mode —
// cross-family disagreement is real evidence the grade needs a closer look,
// not just sampling noise. At the default sample count (3 → 2 secondaries)
// this already puts one cross-provider sample into every ensemble. If Qwen
// isn't configured (no QWEN_API_KEY) that sample fails and drops silently —
// see the .catch(() => null) below — degrading to the pre-Qwen behaviour.
const SECONDARY_SCHEDULE: Array<{
  persona: 'strict' | 'lenient'
  temperature: number
  provider?: 'qwen'
}> = [
  { persona: 'strict',  temperature: 0.8, provider: 'qwen' },
  { persona: 'lenient', temperature: 0.8 },
  { persona: 'strict',  temperature: 0.4, provider: 'qwen' },
  { persona: 'lenient', temperature: 0.4 },
]

// ─── Reconciliation — adjudicate a low-confidence disagreement ─────────────────
//
// TODO Feature AG. A 'low' label today just tells the teacher "look closer"
// and discards the ensemble's own reasoning. The primary already produced a
// full justification (strengths/gaps); the secondaries contribute their raw
// scores. This asks the model to weigh both and commit to one defensible
// number instead of leaving the raw split on the table. Gated on
// confidence === 'low' — the ensemble is already paid for at that point, so
// this only stops throwing away signal on exactly the works dragging down
// aggregate accuracy; it does not run on every graded work.

export interface ReconciliationResult {
  score:      number
  grade:      GradeLetter
  gradeLabel: string
  note:       string   // 1–2 sentence, teacher-facing explanation of the adjudication
}

// Pure prompt assembly — kept separate from the chatJSON call so it's
// unit-testable without mocking an LLM call (matches the calcVerifier /
// citationChecker split of pure-logic vs. I/O in this codebase).
export function buildReconciliationPrompt(
  primary: Pick<GradeOnceResult, 'score' | 'grade' | 'strengths' | 'improvements'>,
  samples: EnsembleSample[],
): { system: string; user: string } {
  const system =
    `Вы старший преподаватель-эксперт, выступающий арбитром между несколькими ` +
    `независимыми проверками одной и той же студенческой работы, которые дали ` +
    `разные оценки. Взвесьте все точки зрения и определите наиболее обоснованный ` +
    `итоговый балл. Отвечайте только валидным JSON.`

  const bullets = (items: { text: string }[]) =>
    items.length > 0 ? items.map((b) => `- ${sanitiseForPrompt(b.text)}`).join('\n') : '- (нет)'

  const sampleLines = samples
    .map((s) => {
      const label = s.persona === 'neutral' && s.temperature == null ? 'основная проверка' : `${s.persona}`
      const temp = s.temperature != null ? `, temperature ${s.temperature}` : ''
      const provider = s.provider ? `, модель ${s.provider}` : ''
      return `- ${label}${temp}${provider}: балл ${s.score}, оценка «${s.grade}»`
    })
    .join('\n')

  const user =
    `Независимые проверки одной работы разошлись во мнениях.\n\n` +
    `## Основная проверка (полный анализ)\nБалл: ${primary.score}, оценка: «${primary.grade}»\n\n` +
    `Сильные стороны:\n${bullets(primary.strengths)}\n\nЗамечания:\n${bullets(primary.improvements)}\n\n` +
    `## Все проверки (балл и оценка)\n${sampleLines}\n\n` +
    `Определите итоговый балл (0–100), взвесив основной анализ и характер разногласий между ` +
    `проверками. Кратко (1–2 предложения, по-русски) объясните преподавателю, на что стоит ` +
    `обратить особое внимание при проверке этой работы.\n\n` +
    `Верните ТОЛЬКО JSON: {"score": число 0–100, "note": "краткое пояснение"}`

  return { system, user }
}

export async function reconcileDisagreement(
  primary: GradeOnceResult,
  samples: EnsembleSample[],
  context: CallContext,
): Promise<ReconciliationResult> {
  const { system, user } = buildReconciliationPrompt(primary, samples)
  const raw = await chatJSON<{ score: number; note: string }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'решение арбитра',
    { context },
  )
  const score = clampScore(raw.score)
  // Same score→grade enforcement gradeOnce/scoreOnce use — an arbiter that
  // moves the score but leaves a stale letter would corrupt QWK the same way
  // an uncalibrated one would.
  const { grade, gradeLabel } = resolveGradeForScore(score, primary.grade, primary.gradeLabel)
  const note = raw.note?.trim() ||
    'Проверяющие разошлись в оценке; итоговый балл скорректирован по совокупности мнений.'
  return { score, grade, gradeLabel, note }
}

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Math.max(0, Math.min(100, isNaN(num) ? 0 : num))
}

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
  // A subset carries providerOverride: 'qwen' — see SECONDARY_SCHEDULE comment.
  const secondaryPromises = SECONDARY_SCHEDULE.slice(0, secondaryCount).map((cfg2) =>
    scoreOnce({
      submissionText:    base.submissionText,
      criteria:          base.criteria,
      examples:          base.examples,
      // Same policy memo the primary grades under — see ScoreOnceParams.
      // Without it the secondaries were scoring from a different brief, so
      // dispersion measured our own information asymmetry as if it were
      // examiner disagreement.
      policyMemo:        base.policyMemo,
      assignmentType:    base.assignmentType,
      referenceSolution: base.referenceSolution,
      assignmentContext: base.assignmentContext,
      persona:           cfg2.persona,
      temperature:       cfg2.temperature,
      context:           base.context,
      providerOverride:  cfg2.provider,
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
      .map((s) => ({
        persona: s.persona, temperature: s.temperature, score: s.score, grade: s.grade,
        ...(s.provider ? { provider: s.provider } : {}),
      })),
  ]

  const stats = computeDispersion(samples)
  const confidence = classifyConfidence(stats, await getActiveThresholds())

  // Reconcile only the residual hard cases — best-effort, never blocks
  // grading (same posture as calibration/RAG elsewhere): a failed
  // reconciliation call just falls back to the primary's own score.
  let reconciliation: ReconciliationResult | null = null
  if (confidence === 'low') {
    try {
      reconciliation = await reconcileDisagreement(primary, samples, base.context)
    } catch (err) {
      logger.warn({
        message: '[Ensemble] Reconciliation pass failed, keeping primary grade',
        error: (err as Error).message,
      })
    }
  }

  const finalPrimary = reconciliation
    ? { ...primary, score: reconciliation.score, grade: reconciliation.grade, gradeLabel: reconciliation.gradeLabel }
    : primary

  return {
    primary: finalPrimary,
    confidence,
    ensemble: {
      samples,
      score_std:       stats.scoreStd,
      score_spread:    stats.scoreSpread,
      grade_agreement: stats.gradeAgreement,
      ...(reconciliation ? { reconciled: true, reconciliation_note: reconciliation.note } : {}),
    },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
