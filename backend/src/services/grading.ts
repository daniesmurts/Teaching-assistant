import { chatJSON, embed, type CallContext } from './deepseek'
import { getActiveProviderName } from './llm/registry'
import { gradeEnsemble } from './confidence'
import { getActiveCalibrationMap, applyCalibration } from './scoreCalibration'
import { findCriteriaByIds } from '../db/queries/criteria'
import {
  createAssignment,
  approveAssignment,
  findAssignmentById,
  findSimilarAssignments,
  findContrastingAssignment,
  resolveInstitutionPoolContext,
  type SimilarAssignment,
} from '../db/queries/assignments'
import { recordRagRetrievals } from '../db/queries/ragRetrievals'
import { findSimilarCriterionExamples, type CriterionExample } from '../db/queries/criterionExamples'
import { sanitiseForCrossTeacherRetrieval } from '../lib/crossTeacherSanitiser'
import { generateAndStoreEmbedding, generateCriterionEmbeddings } from './embeddings'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { getPolicyMemo } from '../db/queries/policyMemos'
import { maybeRegeneratePolicyMemo } from './policyMemo'
import { syncGradeToLtiGradebook } from './ltiServices'
import { verifyCalculation, toImprovementBullet } from './calcVerifier'
import { checkCitations, toCitationBullet } from './citationChecker'
import { canUseFeature } from '../config/planLimits'
import { scoreToGrade, GRADES } from '../../../shared/grades'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type { Assignment, GradeLetter, CriterionScore, CriteriaSnapshotItem, CriterionLevelDescriptors, BulletItem, BulletSeverity, BulletAction, VerificationQuestion, QuestionResponse, CalcStepVerdict, CitationVerdict } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GradeParams {
  teacherId:  string
  institutionId?: string | null
  planTier:   string   // 'free' | 'pro' | 'institution'
  submissionText: string
  criterionIds?: string[]                     // 0–10 ids; empty/absent → holistic
  weights?: number[]                          // same length as criterionIds, sum to 100
  courseId?: string
  studentName?: string
  studentEmail?: string
  studentGroup?: string
  referenceSolution?: string
  assignmentContext?: string   // teacher-supplied assignment brief / situational context
  assignmentType?: 'essay' | 'calculation'
  parentAssignmentId?: string
  thorough?: boolean   // run the confidence ensemble (premium "тщательная проверка")
  checkCitations?: boolean   // opt-in per request (adds latency/cost) — plan-gated in the route
}

interface RevisionCheckItem {
  point:  string
  status: 'addressed' | 'partial' | 'not_addressed'
  note:   string
}

// What the model is asked to return. strengths/improvements may come back
// either as plain strings (legacy) or as {text, quote, page, question?} objects —
// both shapes are normalised in normaliseBullets before persistence. `question`
// is only meaningful on improvement bullets; it's ignored on strengths.
type RawBullet = string | {
  text?:         string
  quote?:        string | null
  page?:         number | null
  question?:     string | null
  criterion_id?: string | null
  // Tier-3 ВКР extension — unused by regular grading callers
  severity?:     unknown
  action?:       unknown
  correction?:   unknown
}

interface AIGradingResult {
  score: number
  grade: GradeLetter
  grade_label: string
  feedback: string
  criteria_scores: CriterionScore[]
  strengths: RawBullet[]
  improvements: RawBullet[]
  verification_questions?: Array<string | { question?: string; quote?: string | null; page?: number | null }>
  revision_check?: RevisionCheckItem[]
  question_responses?: Array<{ question?: string; status?: string; note?: string }>
}

export interface GradeResponse {
  assignment_id: string
  ai_score: number
  ai_grade: GradeLetter
  ai_grade_label: string
  ai_feedback: string
  ai_criteria_scores: CriterionScore[]
  ai_strengths: BulletItem[]
  ai_improvements: BulletItem[]
  ai_verification_questions: VerificationQuestion[]
  ai_revision_check: RevisionCheckItem[] | null
  ai_question_responses: QuestionResponse[] | null
  criteria_snapshot: CriteriaSnapshotItem[] | null
  ai_confidence: import('../../../shared/types').ConfidenceLevel | null
  ai_ensemble: import('../../../shared/types').AiEnsemble | null
  ai_calc_verification: CalcStepVerdict[]
  ai_citation_check: CitationVerdict[]
  used_examples: number
  revision_number: number
  parent_assignment_id: string | null
}

// ─── Criteria resolution ──────────────────────────────────────────────────────

/**
 * Build the criteria snapshot for this grading event from the teacher's chosen
 * criterion_ids + weights. Validates that every id resolves to a criterion the
 * teacher is allowed to use; throws ValidationError otherwise.
 */
export async function resolveCriteriaSnapshot(
  teacherId: string,
  institutionId: string | null,
  ids: string[],
  weights: number[]
): Promise<CriteriaSnapshotItem[]> {
  if (ids.length === 0) return []
  const criteria = await findCriteriaByIds(ids, teacherId, institutionId)
  if (criteria.length !== ids.length) {
    throw new ValidationError('Один или несколько критериев недоступны')
  }
  const byId = new Map(criteria.map((c) => [c.id, c]))
  return ids.map((id, i) => {
    const c = byId.get(id)!
    return {
      criterion_id: c.id,
      name:         c.name,
      weight:       weights[i],
      description:  c.description,
      // Snapshotted so a past grading stays reproducible after the teacher
      // edits the criterion's anchors.
      level_descriptors: c.level_descriptors ?? null,
      max_score:    100,
    } as CriteriaSnapshotItem & { max_score: number }
  })
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

async function retrieveExamples(
  submissionText: string,
  courseId: string,
  teacherId: string
): Promise<{ examples: SimilarAssignment[]; vector: number[] | null }> {
  try {
    const vector = await embed(submissionText, { teacherId, feature: 'embedding' })

    // Institution pool is opt-in on both sides — null when any of the gates is
    // off (no institution, master toggle off, or this course not shared).
    const institutionPool = await resolveInstitutionPoolContext(teacherId, courseId)

    const hits = await findSimilarAssignments(courseId, vector, 5, institutionPool ?? undefined)

    // Sanitise PII on institution-pool hits only — own hits are the teacher's
    // own work and were never anonymised before either.
    const sanitised = hits.map((h) =>
      h.source === 'institution'
        ? { ...h, submission_text: sanitiseForCrossTeacherRetrieval(h.submission_text) }
        : h
    )

    // Contrastive retrieval: if the top hits are all the same grade, the
    // model only ever sees one side of the boundary. Inject one nearest
    // neighbour with a different grade so it sees where the line sits.
    const uniqueGrades = new Set(sanitised.map((h) => h.approved_grade))
    if (sanitised.length > 0 && uniqueGrades.size === 1) {
      const contrast = await findContrastingAssignment(
        courseId,
        vector,
        sanitised.map((h) => h.id),
        [...uniqueGrades],
      )
      if (contrast) sanitised.push(contrast)
    }

    return { examples: sanitised, vector }
  } catch (err) {
    logger.warn({ message: '[RAG] Could not retrieve similar examples', error: (err as Error).message })
    return { examples: [], vector: null }
  }
}

// ─── Pure grading core ────────────────────────────────────────────────────────
//
// gradeOnce() is the single prompt path shared by production grading AND the
// eval harness (offline replay for the flywheel/triage experiments). It has no
// side effects on the database: no assignment row, no usage counter, no
// watermark — those are concerns of grade() below. Keeping the experiment and
// production on one code path is what makes replay results valid.

// Grading persona — biases the examiner's leniency. Used by the confidence
// ensemble to sample genuine disagreement; 'neutral' is the production default.
export type GradingPersona = 'strict' | 'neutral' | 'lenient'

const PERSONA_MODIFIER: Record<GradingPersona, string> = {
  neutral: '',
  strict:  ' Будьте требовательным экзаменатором: придирайтесь к деталям, ' +
           'не завышайте оценку, любые недочёты должны снижать балл.',
  lenient: ' Будьте благожелательным проверяющим: засчитывайте частично верное, ' +
           'не занижайте за мелкие огрехи, оценивайте по существу.',
}

export interface GradeOnceParams {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]   // empty → holistic grading
  examples:       SimilarAssignment[]      // RAG few-shot examples (may be [])
  policyMemo?:    string | null            // distilled teacher-correction patterns for this course
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  assignmentContext?: string               // teacher-supplied assignment brief / situational context
  parent?:        Assignment | null        // revision context, if re-grading a resubmission
  persona?:       GradingPersona           // default 'neutral'
  temperature?:   number                   // for ensemble sampling; default undefined (provider default)
  context:        CallContext              // teacherId + feature, for usage logging
  // Eval harness only — force routing to a specific provider, ignoring the
  // institution preference. Untouched in production.
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen'
  // Run the critic pass over strengths/improvements (grounded + actionable
  // check). Decided by the caller (grade() gates it on the 'feedbackCritic'
  // plan flag; the eval harness can toggle it per replay variant).
  critic?: boolean
  // Agentic calc verification (Feature S) — extract computational steps and
  // check them against a sandboxed arithmetic evaluator instead of trusting
  // the model's own arithmetic. Only meaningful when assignmentType is
  // 'calculation'; decided by the caller like `critic`.
  calcVerification?: boolean
  // Citation existence checking (Feature T) — extract the bibliography and
  // search for each reference instead of trusting it at face value. Opt-in
  // per request (adds latency/cost), resolved+gated at the route like
  // `thorough`, not auto-decided from plan tier alone.
  citationCheck?: boolean
  // Criterion-level RAG (TODO Improvement #9) — past approved feedback for
  // the same criterion name, keyed by lowercased+trimmed criterion name.
  // Populated by grade() from the submission's own embedding (no extra
  // embed() call); undefined/empty when nothing matched or RAG is off.
  criterionExamples?: Record<string, CriterionExample[]>
  // Evidence-first grading (Research §10.3 / TODO Feature AH). Runs a cheap
  // extraction pass FIRST — pull the passages that bear on each criterion —
  // and feeds that validated evidence table into the scoring call, so the
  // model reads before it judges instead of forming a gestalt number and
  // back-filling justification. Costs one extra call; gated by the caller.
  evidenceFirst?: boolean
}

export interface GradeOnceResult {
  score:          number
  grade:          GradeLetter
  gradeLabel:     string
  feedback:       string
  criteriaScores:        CriterionScore[]   // normalised + citation-validated
  strengths:             BulletItem[]       // citation-validated, may have quote+page
  improvements:          BulletItem[]       // same shape, may have quote+page
  verificationQuestions: VerificationQuestion[]   // questions for teacher to ask the student
  questionResponses:     QuestionResponse[] | null   // present only on revision-of-handout
  revisionCheck:  RevisionCheckItem[] | null
  calcVerification: CalcStepVerdict[]   // [] when not run or nothing to report
  citationCheck:  CitationVerdict[]     // [] when not run or nothing to report
}

export interface GradingMessages {
  system:    string
  user:      string
  pageCount: number
}

/**
 * Long analytical work is where a reasoning model earns its cost (Research
 * §10.5). Calculation work always used it; this extends that to the deliberate
 * «тщательная проверка» path (teacher already accepted extra latency) and to
 * genuinely long submissions.
 *
 * The threshold is deliberately conservative. Measured on a real corpus the
 * average submission is ~15k chars, so a 12–15k cut-off would route the
 * MAJORITY of gradings through the reasoner — a large, silent spend increase,
 * which is not a change to make quietly (see the 2026-07-24 DeepSeek 402
 * balance incident). 40k targets the genuine long tail below the 120k mark
 * where the ВКР long-review pipeline takes over instead.
 *
 * Lowering this is a cost decision, not a tuning detail — it should be made
 * with spend data, not by intuition.
 *
 * Pure and exported so the threshold is testable and reviewable rather than
 * buried in a conditional.
 */
export const REASONER_CHAR_THRESHOLD = 40000

export function shouldUseReasoner(params: {
  assignmentType?: 'essay' | 'calculation'
  submissionText:  string
  evidenceFirst?:  boolean
}): boolean {
  if (params.assignmentType === 'calculation') return true
  if (params.evidenceFirst) return true
  return params.submissionText.length >= REASONER_CHAR_THRESHOLD
}

/**
 * Deterministic prompt assembly — fully testable without network. Everything
 * that decides WHAT the model sees lives here; gradeOnce only adds the call
 * and response normalisation.
 */
export function buildGradingMessages(params: {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]
  examples:       SimilarAssignment[]
  policyMemo?:    string | null
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  assignmentContext?: string
  parent?:        Assignment | null
  persona?:       GradingPersona
  criterionExamples?: Record<string, CriterionExample[]>
  /** Validated per-criterion passages from the evidence-first pass, if it ran. */
  evidence?:      CriterionEvidence[]
}): GradingMessages {
  const isCalc     = params.assignmentType === 'calculation'
  const isRevision = params.parent != null
  // Only ask for question_responses when the parent's handout actually had
  // questions — otherwise the field would always come back empty and waste
  // tokens.
  const hasHandoutQuestions = isRevision && (params.parent!.ai_handout?.questions.length ?? 0) > 0

  const base = isCalc
    ? `Вы опытный преподаватель точных наук (математика, физика, инженерные дисциплины). ` +
      `Проверяйте расчётные задачи строго: пошагово пересчитывайте решение, проверяйте формулы, ` +
      `единицы измерения, размерности и числовой ответ. Отличайте ошибку метода от арифметической описки ` +
      `и справедливо начисляйте частичный балл за верный ход решения. ` +
      `Давайте обратную связь на русском языке. Всегда отвечайте только валидным JSON-объектом.`
    : `Вы опытный преподаватель-эксперт. Ваша задача — объективно оценивать студенческие работы ` +
      `и давать конструктивную обратную связь на русском языке. Всегда отвечайте только валидным JSON.`

  const system = base + PERSONA_MODIFIER[params.persona ?? 'neutral']

  const revisionBlock = isRevision ? buildRevisionContext(params.parent!) : ''

  const assignmentContext = params.assignmentContext?.trim()
    ? `## Задание и контекст
Ниже — формулировка задания и/или условия, в которых выполнялась работа (это указал преподаватель).
Оценивайте работу СТРОГО в рамках этого задания и контекста. Не предъявляйте требований, выходящих
за его рамки, и не делайте предположений о типе или характере работы, которые ему противоречат.
<assignment_context>
${sanitiseForPrompt(params.assignmentContext.trim())}
</assignment_context>

`
    : ''

  const reference = params.referenceSolution?.trim()
    ? `## Эталонное решение / правильный ответ
Сравнивайте работу студента с этим эталоном. Если ответ студента совпадает по существу — засчитывайте, даже если оформление отличается.
<reference_solution>
${sanitiseForPrompt(params.referenceSolution.trim())}
</reference_solution>

`
    : ''

  const { text: annotated, pageCount } = annotateWithPageMarkers(params.submissionText)

  // Evidence table (when phase 1 ran) sits ahead of the criteria/submission so
  // the model meets the passages before it meets the scoring instruction.
  const evidenceBlock = params.evidence?.length ? buildEvidenceBlock(params.evidence) : ''

  const user = revisionBlock + assignmentContext + reference + evidenceBlock + (params.criteria.length > 0
    ? buildCriteriaPrompt(annotated, params.criteria, params.examples, params.policyMemo, isCalc, isRevision, pageCount, hasHandoutQuestions, params.criterionExamples)
    : buildHolisticPrompt(annotated, params.examples, params.policyMemo, isCalc, isRevision, pageCount, hasHandoutQuestions))

  return { system, user, pageCount }
}

/** One grading call: prompt → model → normalised result. No DB writes. */
export async function gradeOnce(params: GradeOnceParams): Promise<GradeOnceResult> {
  const isCalc = params.assignmentType === 'calculation'

  // Phase 1 (opt-in): read the work and extract per-criterion evidence before
  // any number exists. Fails soft — a failed extraction degrades to plain
  // single-pass grading rather than blocking the grade.
  let evidence: CriterionEvidence[] = []
  if (params.evidenceFirst) {
    try {
      evidence = await extractEvidence(params)
    } catch (err) {
      logger.warn({ message: '[EvidenceFirst] Extraction failed, grading in one pass', error: (err as Error).message })
    }
  }

  const { system, user, pageCount } = buildGradingMessages({ ...params, evidence })

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'результат оценивания',
    {
      context:          params.context,
      // Reasoning was reserved for calculation work. The marginal gain from
      // reasoning concentrates on the hard/long tail of analytical work too,
      // so route those through it as well — see shouldUseReasoner.
      reasoner:         shouldUseReasoner(params),
      temperature:      params.temperature,
      providerOverride: params.providerOverride,
    },
  )

  // One tally across every quote-bearing field this grading produced, so the
  // omission-vs-rejection split is observable instead of guessed at.
  const citationStats = newCitationStats()

  let strengths    = normaliseBullets(result.strengths ?? [], params.submissionText, pageCount, params.criteria, citationStats)
  let improvements = normaliseBullets(result.improvements ?? [], params.submissionText, pageCount, params.criteria, citationStats)

  if (params.critic) {
    try {
      const critiqued = await critiqueFeedback(strengths, improvements, params.submissionText, params.context, params.providerOverride)
      strengths    = critiqued.strengths
      improvements = critiqued.improvements
    } catch (err) {
      // Never let the critic pass block grading — fall back to the raw bullets.
      logger.warn({ message: '[Critic] Feedback critique failed, using raw bullets', error: (err as Error).message })
    }
  }

  let calcVerification: CalcStepVerdict[] = []
  if (params.calcVerification && isCalc) {
    calcVerification = await verifyCalculation({
      submissionText:     params.submissionText,
      referenceSolution:  params.referenceSolution,
      assignmentContext:  params.assignmentContext,
      context:            params.context,
      providerOverride:   params.providerOverride,
    })
    const mismatchBullets = calcVerification
      .filter((v) => v.verdict === 'arithmetic_error')
      .map((v) => toImprovementBullet(v, params.submissionText, pageCount))
    improvements = [...improvements, ...mismatchBullets]
  }

  let citationCheck: CitationVerdict[] = []
  if (params.citationCheck) {
    citationCheck = await checkCitations({
      submissionText:   params.submissionText,
      context:          params.context,
      providerOverride: params.providerOverride,
    })
    const notFoundBullets = citationCheck
      .filter((v) => v.status === 'not_found')
      .map((v) => toCitationBullet(v, params.submissionText))
    improvements = [...improvements, ...notFoundBullets]
  }

  const criteriaScores = normaliseCriteriaScores(result.criteria_scores ?? [], params.submissionText, pageCount, citationStats)

  // Grounding telemetry. `absent` means the model never offered a quote (a
  // prompt problem); `rejectedNotFound` means it offered one that isn't in the
  // submission (a matcher-tolerance or hallucination problem). Logged at info
  // so the split is greppable in production without a schema change.
  const citationTotal = citationStats.absent + citationStats.accepted +
    citationStats.rejectedNotFound + citationStats.rejectedTooShort
  if (citationTotal > 0) {
    logger.info({
      message: '[Grounding] citation outcomes for one grading',
      ...citationStats,
      total: citationTotal,
      groundedShare: Math.round((citationStats.accepted / citationTotal) * 100) / 100,
      submissionChars: params.submissionText.length,
    })
  }

  // Deterministic aggregation (Research §10.4 / TODO Feature AI): when the
  // grading is criteria-scoped, the weights already sum to 100 — don't trust
  // the model's freehand holistic number, compute the overall as the weighted
  // sum of its own per-criterion scores. Removes holistic-drift/arithmetic
  // error as a failure class and makes the number auditable. Falls back to
  // the model's raw score if a criterion's name didn't match (never silently
  // aggregates a partial set). The grade LETTER is then re-derived from the
  // aggregated score — see resolveGradeForScore.
  const aggregated = params.criteria.length > 0
    ? aggregateWeightedScore(criteriaScores, params.criteria)
    : null

  const score = aggregated ?? clampScore(result.score)
  const { grade, gradeLabel } = resolveGradeForScore(
    score, normaliseGrade(result.grade), result.grade_label,
  )

  return {
    score,
    grade,
    gradeLabel,
    feedback:       result.feedback ?? '',
    criteriaScores,
    strengths,
    improvements,
    verificationQuestions: normaliseVerificationQuestions(result.verification_questions ?? [], params.submissionText, pageCount),
    revisionCheck:         params.parent != null ? normaliseRevisionCheck(result.revision_check) : null,
    questionResponses:     (params.parent?.ai_handout?.questions.length ?? 0) > 0
                            ? normaliseQuestionResponses(result.question_responses)
                            : null,
    calcVerification,
    citationCheck,
  }
}

// ─── Evidence-first pass (Research §10.3 / TODO Feature AH) ──────────────────
//
// A single call that emits score + feedback + quotes together lets the model
// anchor on a first-impression number and then rationalise it. Splitting the
// job forces reading before judging: phase 1 extracts the passages that bear on
// each criterion, every quote is validated verbatim the same way grading
// citations are, and phase 2 scores with that evidence table in front of it.
//
// Deliberately extraction-only — this pass never proposes a score. If it did,
// phase 2 would just anchor on *its* number and we'd have moved the problem.

export interface CriterionEvidence {
  criterion: string
  quotes:    string[]
}

/** Pure — renders the validated evidence table into the scoring prompt. */
export function buildEvidenceBlock(evidence: CriterionEvidence[]): string {
  const usable = evidence.filter((e) => e.quotes.length > 0)
  if (usable.length === 0) return ''
  const body = usable
    .map((e) => `### ${sanitiseForPrompt(e.criterion)}\n${e.quotes.map((q) => `- «${sanitiseForPrompt(q)}»`).join('\n')}`)
    .join('\n')
  return `## Выписанные из работы фрагменты по критериям
Ниже — фрагменты, уже найденные в работе на предыдущем шаге (проверены дословно).
Опирайтесь на них при выставлении баллов: сначала соотнесите фрагменты с уровнями критерия, затем ставьте балл.
Это не полный список — если для вывода нужен другой фрагмент, найдите его в тексте работы сами.

${body}

`
}

async function extractEvidence(params: GradeOnceParams): Promise<CriterionEvidence[]> {
  const { text: annotated } = annotateWithPageMarkers(params.submissionText)
  const criteriaList = params.criteria.length > 0
    ? params.criteria.map((c) => `- ${c.name}${c.description ? `: ${sanitiseForPrompt(c.description)}` : ''}`).join('\n')
    : '- Общее качество работы (тезис, аргументация, выводы, оформление)'

  const system = `Вы — внимательный читатель студенческих работ. На этом шаге вы НЕ выставляете оценку и НЕ пишете отзыв. ` +
    `Ваша единственная задача — выписать из работы дословные фрагменты, которые относятся к каждому критерию: и подтверждающие сильные стороны, и показывающие недостатки. ` +
    `Копируйте фрагменты ПОСИМВОЛЬНО из текста работы, ничего не перефразируя. Отвечайте только валидным JSON.`

  const user = `## Критерии\n${criteriaList}\n\n## Работа студента\n<student_submission>\n${sanitiseForPrompt(annotated)}\n</student_submission>\n\n` +
    `Верните JSON: {"evidence": [{"criterion": название критерия, "quotes": [2–4 дословных фрагмента по 5–20 слов]}]}. ` +
    `Включите объект для КАЖДОГО критерия. Не оценивайте и не комментируйте — только фрагменты.`

  const result = await chatJSON<{ evidence?: Array<{ criterion?: unknown; quotes?: unknown }> }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'выписка фрагментов',
    { context: params.context, providerOverride: params.providerOverride },
  )

  // Validate every extracted quote against the submission — an unverifiable
  // fragment must never reach the scoring prompt, or phase 2 would reason from
  // text that isn't in the work.
  const haystack = params.submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  const raw = Array.isArray(result.evidence) ? result.evidence : []
  return raw
    .map((e) => ({
      criterion: typeof e.criterion === 'string' ? e.criterion.trim() : '',
      quotes: (Array.isArray(e.quotes) ? e.quotes : [])
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter((q) => {
          const normalised = q.toLowerCase().replace(/\s+/g, ' ').trim()
          return normalised.length >= 8 && haystack.includes(normalised)
        })
        .slice(0, 4)
        .map((q) => q.slice(0, 200)),
    }))
    .filter((e) => e.criterion.length > 0)
}

// ─── Critic / verification pass ──────────────────────────────────────────────
//
// A second, cheap LLM call over the already-normalised bullets. Vague or
// ungrounded feedback ("слабая аргументация") is the #1 complaint about AI
// grading — this pass forces every bullet to either be concrete and tied to
// the submission, or get dropped. Runs after citation validation, so quotes
// are already verified; the critic only judges the prose claim itself.

export interface CritiqueVerdict {
  kind:            'strength' | 'improvement'
  index:           number
  verdict:         'keep' | 'rewrite' | 'drop'
  rewritten_text?: string
}

/**
 * Build the submission context the critic judges "is this bullet grounded?"
 * against.
 *
 * This used to be `submissionText.slice(0, 4000)` — a blind prefix. Measured
 * on a real corpus the average submission is ~15k chars (max 117k) and 43%
 * exceed 4k, so the critic was ruling on evidence it could not see and
 * dropping or vaguening bullets that were correctly grounded in later pages.
 * Because it runs only for Pro+ (`feedbackCritic`), paying users on long works
 * were hit hardest.
 *
 * Bullets already carry a quote that `validateCitation` verified appears in the
 * submission, so instead of guessing we window around each real anchor. Falls
 * back to a head excerpt only for bullets with no quote at all (absence-type
 * findings), which is the one case where there is nothing to anchor to.
 */
export function buildCriticContext(
  submissionText: string,
  bullets: BulletItem[],
  opts: { window?: number; headChars?: number; maxChars?: number } = {},
): string {
  const window    = opts.window    ?? 400
  const headChars = opts.headChars ?? 1500
  const maxChars  = opts.maxChars  ?? 12000

  const haystack = submissionText.toLowerCase()
  // Head excerpt always included: gives the critic the work's framing, and is
  // the only context available for bullets about something being absent.
  const segments: Array<[number, number]> = [[0, Math.min(headChars, submissionText.length)]]

  for (const b of bullets) {
    if (!b.quote) continue
    const idx = haystack.indexOf(b.quote.toLowerCase())
    if (idx === -1) continue
    segments.push([
      Math.max(0, idx - window),
      Math.min(submissionText.length, idx + b.quote.length + window),
    ])
  }

  // Merge overlapping/adjacent windows so the same passage isn't sent twice.
  segments.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && seg[0] <= last[1]) last[1] = Math.max(last[1], seg[1])
    else merged.push([...seg] as [number, number])
  }

  let out = ''
  for (const [start, end] of merged) {
    if (out.length >= maxChars) break
    const piece = submissionText.slice(start, end)
    const prefix = out ? (start > 0 ? '\n\n[…]\n\n' : '\n\n') : (start > 0 ? '[…]\n\n' : '')
    out += prefix + piece.slice(0, Math.max(0, maxChars - out.length))
  }
  return out
}

/** Pure — applies critique verdicts to a bullet list. Unit-testable without an LLM call. */
export function applyCritiqueVerdicts(
  bullets: BulletItem[],
  verdicts: CritiqueVerdict[],
  kind: 'strength' | 'improvement',
): BulletItem[] {
  const byIndex = new Map(verdicts.filter((v) => v.kind === kind).map((v) => [v.index, v]))
  const result: BulletItem[] = []
  bullets.forEach((bullet, i) => {
    const v = byIndex.get(i)
    if (!v || v.verdict === 'keep') {
      result.push(bullet)
      return
    }
    if (v.verdict === 'drop') return
    // 'rewrite' — only apply if the model actually supplied usable replacement text.
    const rewritten = typeof v.rewritten_text === 'string' ? v.rewritten_text.trim() : ''
    result.push(rewritten.length >= 8 ? { ...bullet, text: rewritten.slice(0, 300) } : bullet)
  })
  return result
}

async function critiqueFeedback(
  strengths: BulletItem[],
  improvements: BulletItem[],
  submissionText: string,
  context: CallContext,
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen',
): Promise<{ strengths: BulletItem[]; improvements: BulletItem[] }> {
  if (strengths.length === 0 && improvements.length === 0) return { strengths, improvements }

  // Show the critic each bullet's own verified anchor, so "is this grounded?"
  // is a question about the claim rather than a guess about unseen text.
  const listBlock = (kind: 'strength' | 'improvement', items: BulletItem[]) =>
    items.map((b, i) =>
      `[${kind} ${i}] ${b.text}` +
      (b.quote ? `\n    цитата из работы: «${b.quote}»` : `\n    (без цитаты — замечание об отсутствии либо необоснованный пункт)`)
    ).join('\n')

  const system = `Вы — строгий редактор обратной связи по студенческим работам. Ваша задача — проверить каждый пункт отзыва на два критерия: ` +
    `(1) ОБОСНОВАННОСТЬ — утверждение действительно подтверждается текстом работы, а не общими словами; ` +
    `(2) КОНКРЕТНОСТЬ — пункт говорит, что именно сделано хорошо/плохо и (для improvements) что конкретно изменить, а не общая фраза вроде «слабая аргументация». ` +
    `Для каждого пункта верните вердикт: "keep" (уже хорош), "rewrite" (перепишите короче и конкретнее, сохраняя суть) или "drop" (пункт не по существу, ничем не обоснован). ` +
    `Отвечайте только валидным JSON.`

  const submissionContext = buildCriticContext(submissionText, [...strengths, ...improvements])

  const user = `## Работа студента (начало работы + фрагменты вокруг каждой цитаты; «[…]» — пропущенный текст)\n${sanitiseForPrompt(submissionContext)}\n\n` +
    `## Пункты отзыва для проверки\n${listBlock('strength', strengths)}\n${listBlock('improvement', improvements)}\n\n` +
    `Цитаты в списке уже проверены — они действительно взяты из работы. Не отбрасывайте пункт только потому, что относящийся к нему фрагмент не попал в показанные отрывки. ` +
    `Верните JSON: {"verdicts": [{"kind": "strength"|"improvement", "index": число, "verdict": "keep"|"rewrite"|"drop", "rewritten_text": строка (только если verdict="rewrite")}]}. ` +
    `Включите вердикт для КАЖДОГО пункта из списка выше.`

  const result = await chatJSON<{ verdicts: CritiqueVerdict[] }>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'критика отзыва',
    { context, providerOverride },
  )

  const verdicts = Array.isArray(result.verdicts) ? result.verdicts : []
  return {
    strengths:    applyCritiqueVerdicts(strengths, verdicts, 'strength'),
    improvements: applyCritiqueVerdicts(improvements, verdicts, 'improvement'),
  }
}

// ─── Score-only sampling (for the confidence ensemble) ───────────────────────
//
// The ensemble needs M independent score estimates to measure disagreement,
// but only the PRIMARY run needs full prose feedback. scoreOnce() asks the
// model for just {score, grade} under the same submission + criteria + persona,
// at ~1/5 the output tokens of a full grade. This keeps "thorough mode" at
// roughly 1× full grade + (M−1)× cheap samples instead of M× full grades.

export interface ScoreOnceParams {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]
  examples:       SimilarAssignment[]
  // Same grading-policy memo the primary gets. Without it the secondaries
  // scored under materially different information from the primary, so the
  // ensemble's dispersion conflated genuine disagreement about the work with
  // an information asymmetry we created ourselves — inflating score_std,
  // over-reporting 'low' confidence, and skewing the fitted thresholds.
  policyMemo?:    string | null
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  assignmentContext?: string
  persona?:       GradingPersona
  temperature?:   number
  context:        CallContext
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen'
}

export interface ScoreOnceResult {
  score: number
  grade: GradeLetter
}

export async function scoreOnce(params: ScoreOnceParams): Promise<ScoreOnceResult> {
  const isCalc = params.assignmentType === 'calculation'
  const base = isCalc
    ? `Вы строгий преподаватель точных наук. Пошагово проверьте расчёт и выставьте балл.`
    : `Вы опытный преподаватель-эксперт. Оцените работу студента и выставьте балл.`
  const system = base + PERSONA_MODIFIER[params.persona ?? 'neutral'] +
    ` Отвечайте только валидным JSON.`

  const assignmentContext = params.assignmentContext?.trim()
    ? `\n## Задание и контекст\nОценивайте СТРОГО в рамках этого задания, не выходя за его условия.\n<assignment_context>\n${sanitiseForPrompt(params.assignmentContext.trim())}\n</assignment_context>\n`
    : ''
  const reference = params.referenceSolution?.trim()
    ? `\n## Эталон\n<reference>\n${sanitiseForPrompt(params.referenceSolution.trim())}\n</reference>\n`
    : ''
  // Criteria carry their DESCRIPTIONS here, not just name+weight — the
  // description is what defines "good" for that criterion, and the primary
  // always sees it. Same reasoning as policyMemo/examples below: the
  // ensemble's job is to disagree about the work, not about the brief.
  const criteriaBlock = params.criteria.length > 0
    ? `\n## Критерии\n${params.criteria
        .map((c) => `- ${c.name} (вес ${c.weight}%)${c.description ? `: ${sanitiseForPrompt(c.description)}` : ''}`)
        .join('\n')}\n`
    : ''
  // Reuse the primary's own examples block (submission excerpts + teacher
  // feedback) instead of the bare grade labels this used to send, so both
  // sides of the ensemble reason from identical retrieved evidence.
  //
  // criterionExamples is deliberately NOT plumbed through: scoreOnce emits no
  // per-criterion scores, so per-criterion feedback exemplars have no output
  // surface to act on, and they're the bulkiest input of the three.
  const examplesBlock = buildExamplesBlock(params.examples)

  const user =
    `${buildPolicyMemoBlock(params.policyMemo)}${criteriaBlock}${examplesBlock}${assignmentContext}${reference}\n## Работа студента\n<submission>\n` +
    `${sanitiseForPrompt(params.submissionText)}\n</submission>\n\n` +
    `Верните ТОЛЬКО JSON: {"score": число 0–100, "grade": "5"|"4"|"3"|"2"} ` +
    `(5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60). Без пояснений.`

  const result = await chatJSON<{ score: number; grade: string }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'балл',
    {
      context:          params.context,
      reasoner:         isCalc,
      temperature:      params.temperature,
      providerOverride: params.providerOverride,
    },
  )

  // Same score→grade enforcement as gradeOnce. Matters here because
  // computeDispersion derives `gradeAgreement` from these letters — an
  // internally inconsistent (score, grade) pair would show up as ensemble
  // disagreement that isn't really disagreement about the work's quality.
  const score = clampScore(result.score)
  return { score, grade: scoreToGrade(score) }
}

// ─── Grade (production path: resolve inputs → gradeOnce → persist) ───────────

export async function grade(params: GradeParams): Promise<GradeResponse> {
  const ragEnabled = canUseFeature(params.planTier, 'ragFlywheel')
  const ids     = params.criterionIds ?? []
  const weights = params.weights ?? []

  const [snapshot, ragResult, parent, policyMemo] = await Promise.all([
    resolveCriteriaSnapshot(params.teacherId, params.institutionId ?? null, ids, weights),
    ragEnabled && params.courseId
      ? retrieveExamples(params.submissionText, params.courseId, params.teacherId)
      : Promise.resolve({ examples: [] as SimilarAssignment[], vector: null as number[] | null }),
    params.parentAssignmentId
      ? findAssignmentById(params.parentAssignmentId, params.teacherId)
      : Promise.resolve(null),
    ragEnabled && params.courseId
      ? getPolicyMemo(params.courseId)
      : Promise.resolve(null),
  ])
  const { examples, vector } = ragResult

  // Criterion-level RAG (TODO Improvement #9) — reuses the submission vector
  // already computed above, so this adds zero embedding-provider calls, only
  // cheap local Postgres queries. Own-course only (see findSimilarCriterionExamples).
  let criterionExamples: Record<string, CriterionExample[]> | undefined
  if (ragEnabled && snapshot.length > 0 && vector && params.courseId) {
    try {
      const courseId = params.courseId
      const perCriterion = await Promise.all(
        snapshot.map(async (c) =>
          [c.name.toLowerCase().trim(), await findSimilarCriterionExamples(courseId, c.name, vector, 2)] as const
        )
      )
      criterionExamples = Object.fromEntries(perCriterion.filter(([, ex]) => ex.length > 0))
    } catch (err) {
      logger.warn({ message: '[RAG] Could not retrieve criterion-level examples', error: (err as Error).message })
    }
  }

  const gradeParams = {
    submissionText:    params.submissionText,
    criteria:          snapshot,
    examples,
    criterionExamples,
    policyMemo:        policyMemo?.memo_text ?? null,
    assignmentType:    params.assignmentType,
    referenceSolution: params.referenceSolution,
    assignmentContext: params.assignmentContext,
    parent,
    context:           {
      teacherId:     params.teacherId,
      institutionId: params.institutionId ?? undefined,
      feature:       'grading' as const,
    },
    critic: canUseFeature(params.planTier, 'feedbackCritic'),
    calcVerification: params.assignmentType === 'calculation' && canUseFeature(params.planTier, 'calcVerification'),
    citationCheck: Boolean(params.checkCitations),
    // Evidence-first (Feature AH) costs one extra call per grading, so it is
    // tied to the explicit «тщательная проверка» opt-in rather than firing on
    // every graded work — the teacher has already accepted extra latency
    // there, and that path is also where the ensemble runs.
    evidenceFirst: Boolean(params.thorough) && canUseFeature(params.planTier, 'evidenceFirst'),
  }

  // "Thorough" mode runs the confidence ensemble: the primary call still
  // provides the full feedback, plus cheap score-only samples whose
  // disagreement yields a confidence label. Revisions skip it — the
  // revision-check flow is its own thing and ensemble adds little there.
  const ensemble = params.thorough && parent == null
    ? await gradeEnsemble(gradeParams)
    : null
  const result = ensemble ? ensemble.primary : await gradeOnce(gradeParams)

  // Per-scope score calibration (Research §10.1 / TODO Feature AF) — corrects
  // systematic per-teacher/per-course bias against the teacher's own scale.
  // Course -> teacher -> institution backoff; passes the score through
  // unchanged (never blocks grading) when no scope has enough approved
  // history fitted yet, or the lookup itself fails.
  let calibratedScore = result.score
  try {
    const calibrationMap = await getActiveCalibrationMap(
      params.courseId ?? null, params.teacherId, params.institutionId ?? null,
    )
    calibratedScore = applyCalibration(result.score, calibrationMap)
  } catch (err) {
    logger.warn({ message: '[Calibration] Could not load calibration map, using raw score', error: (err as Error).message })
  }

  // Calibration moves the score, so the letter has to follow it — same
  // contract gradeOnce enforces. Without this, calibration would improve MAE
  // while leaving a stale letter, and QWK (computed on letters) would never
  // see the gain.
  const { grade: calibratedGrade, gradeLabel: calibratedGradeLabel } =
    resolveGradeForScore(calibratedScore, result.grade, result.gradeLabel)

  // Merge AI per-criterion scores back into the snapshot so the history view
  // can reconstruct exactly what was graded against what.
  const filledSnapshot: CriteriaSnapshotItem[] | null = snapshot.length > 0
    ? mergeScoresIntoSnapshot(snapshot, result.criteriaScores)
    : null

  // Provider attribution — record the *intended* provider (silent fallback
  // doesn't change what the institution asked for). Calc grading carves out
  // to DeepSeek regardless; getActiveProviderName honours that.
  const providerName = await getActiveProviderName(
    gradeParams.context,
    { reasoner: params.assignmentType === 'calculation' },
  )

  const assignment = await createAssignment({
    teacherId: params.teacherId,
    courseId: params.courseId,
    studentName: params.studentName,
    studentEmail: params.studentEmail,
    studentGroup: params.studentGroup,
    submissionText: params.submissionText,
    aiScore: calibratedScore,
    // Pre-calibration score, persisted so future refits train on the model's
    // OWN output rather than on scores a previous calibration already
    // corrected (which would make each refit learn "calibrated → teacher"
    // and compound the correction). See db/queries/scoreCalibration.ts.
    aiScoreRaw: result.score,
    aiGrade: calibratedGrade,
    aiGradeLabel: calibratedGradeLabel,
    aiFeedback: applyWatermark(result.feedback, params.planTier),
    aiCriteriaScores: result.criteriaScores,
    aiStrengths: result.strengths,
    aiImprovements: result.improvements,
    aiVerificationQuestions: result.verificationQuestions,
    criteriaSnapshot: filledSnapshot,
    parentAssignmentId: parent?.id,
    aiRevisionCheck: result.revisionCheck ?? undefined,
    aiQuestionResponses: result.questionResponses ?? undefined,
    aiConfidence: ensemble?.confidence ?? null,
    aiEnsemble: ensemble?.ensemble ?? null,
    aiCalcVerification: result.calcVerification,
    aiCitationCheck: result.citationCheck,
    aiProvider: providerName,
  })

  incrementUsage(params.teacherId, 'grade').catch(() => null)

  // Audit which past works were retrieved as RAG examples for this grade.
  // Fire-and-forget — a failure here must never block the grade response.
  // Powers the «использовано как образец» metric on the Learning Loop page.
  if (examples.length > 0) {
    recordRagRetrievals(
      assignment.id,
      examples.map((ex) => ({ id: ex.id, similarity: ex.similarity })),
    ).catch((err) => logger.warn({
      message: 'Failed to log RAG retrievals',
      assignmentId: assignment.id,
      error: (err as Error).message,
    }))
  }

  return {
    assignment_id: assignment.id,
    ai_score: assignment.ai_score!,
    ai_grade: assignment.ai_grade!,
    ai_grade_label: assignment.ai_grade_label!,
    ai_feedback: assignment.ai_feedback!,
    ai_criteria_scores: assignment.ai_criteria_scores ?? [],
    ai_strengths: assignment.ai_strengths ?? [],
    ai_improvements: assignment.ai_improvements ?? [],
    ai_verification_questions: assignment.ai_verification_questions ?? [],
    ai_revision_check: assignment.ai_revision_check,
    ai_question_responses: assignment.ai_question_responses,
    criteria_snapshot: assignment.criteria_snapshot,
    ai_confidence: assignment.ai_confidence,
    ai_ensemble: assignment.ai_ensemble,
    ai_calc_verification: assignment.ai_calc_verification ?? [],
    ai_citation_check: assignment.ai_citation_check ?? [],
    used_examples: examples.length,
    revision_number: assignment.revision_number,
    parent_assignment_id: assignment.parent_assignment_id,
  }
}

function mergeScoresIntoSnapshot(
  snapshot: CriteriaSnapshotItem[],
  aiScores: CriterionScore[]
): CriteriaSnapshotItem[] {
  const byName = new Map(aiScores.map((s) => [s.name.toLowerCase().trim(), s]))
  return snapshot.map((item) => {
    const match = byName.get(item.name.toLowerCase().trim())
    return match
      ? { ...item, score: match.score, feedback: match.feedback }
      : item
  })
}

/**
 * Enforce the score→grade contract the grading prompt already states
 * (5: 87–100, 4: 73–86, 3: 60–72, 2: <60).
 *
 * Those bands were declared in four prompt strings and in the frontend's
 * `scoreToGrade`, but never applied server-side — the persisted letter was
 * whatever the model emitted. That broke in two ways:
 *   1. Post-processing moves the score (deterministic weighted aggregation,
 *      per-scope calibration) while the letter stays put, producing
 *      internally contradictory records — a weighted sum of 71 labelled «5».
 *   2. Even with no post-processing, a model can emit an inconsistent pair.
 *
 * This is load-bearing for accuracy measurement, not cosmetic: the eval
 * harness computes QWK — the headline agreement metric — on grade LETTERS, so
 * any score-only improvement stayed invisible to it while the letter was stale.
 *
 * The label follows the letter: kept as the model wrote it while the letter
 * still agrees, regenerated whenever we moved the letter, so the two can never
 * contradict each other.
 */
export function resolveGradeForScore(
  score:      number,
  modelGrade: GradeLetter,
  modelLabel?: string | null,
): { grade: GradeLetter; gradeLabel: string } {
  const grade = scoreToGrade(score)
  const gradeLabel = grade === modelGrade
    ? (modelLabel?.trim() || gradeToLabel(grade))
    : gradeToLabel(grade)
  return { grade, gradeLabel }
}

/**
 * Deterministic weighted-sum overall score (Research §10.4 / TODO Feature AI).
 * `criteria` weights are validated at snapshot-resolution time to sum to 100
 * (resolveCriteriaSnapshot), so the aggregate is just Σ(score·weight)/100.
 * Returns null — signalling "fall back to the model's own holistic score" —
 * when any criterion has no matching AI score by name (never aggregates a
 * partial set, since that would silently understate the true weighted total).
 */
export function aggregateWeightedScore(
  aiScores: CriterionScore[],
  criteria: CriteriaSnapshotItem[]
): number | null {
  if (criteria.length === 0) return null
  const byName = new Map(aiScores.map((s) => [s.name.toLowerCase().trim(), s.score]))
  let total = 0
  for (const c of criteria) {
    const score = byName.get(c.name.toLowerCase().trim())
    if (score == null) return null
    total += score * c.weight
  }
  return clampScore(Math.round(total / 100))
}

/**
 * Convert form-feed page boundaries in the raw submission into "[стр. N]"
 * headers the AI can cite. Page 1 is implicit (no header before the first
 * page), subsequent pages are prefixed. Returns the annotated text plus the
 * total page count so the prompt can constrain the citation field.
 */
export function annotateWithPageMarkers(text: string): { text: string; pageCount: number } {
  if (!text.includes('\f')) return { text, pageCount: 1 }
  const pages = text.split('\f')
  const annotated = pages
    .map((page, i) => (i === 0 ? page : `\n\n[стр. ${i + 1}]\n${page}`))
    .join('')
  return { text: annotated, pageCount: pages.length }
}

/**
 * Validate citations against the original (un-annotated) submission. A quote
 * survives only if it actually appears in the source — otherwise the model
 * hallucinated it. Pages are clamped to the document's real range.
 */
export function normaliseCriteriaScores(
  scores: CriterionScore[],
  submissionText: string,
  pageCount: number,
  stats?: CitationStats,
): CriterionScore[] {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  return scores.map((s) => {
    const next: CriterionScore = {
      // The model sometimes echoes the weight into the name («Структура (вес: 40%)»)
      // — strip it so display stays clean and the snapshot merge-by-name works.
      name:     String(s.name ?? '').replace(/\s*\(вес:?\s*\d+\s*%?\)\s*$/i, '').trim(),
      score:    clampScore(s.score),
      feedback: String(s.feedback ?? '').trim(),
      quote:    null,
      page:     null,
    }
    const validated = validateCitation(s.quote, s.page, haystack, pageCount, stats)
    next.quote = validated.quote
    next.page  = validated.page
    return next
  })
}

/**
 * Normalise a strengths/improvements list. Accepts either plain strings (legacy
 * shape) or {text, quote?, page?} objects from the new prompt. Citations are
 * validated against the submission so hallucinated quotes are dropped.
 */
export function normaliseBullets(
  bullets: RawBullet[],
  submissionText: string,
  pageCount: number,
  criteriaSnapshot: CriteriaSnapshotItem[] = [],
  stats?: CitationStats,
): BulletItem[] {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  const validCriterionIds = new Set(
    criteriaSnapshot.map((c) => c.criterion_id).filter((id): id is string => !!id)
  )
  return bullets
    .map((b): BulletItem | null => {
      const text = extractBulletText(b)
      if (!text) return null
      if (typeof b === 'string') {
        if (stats) stats.absent++
        return { text, quote: null, page: null, question: null, criterion_id: null }
      }
      const { quote, page } = validateCitation(b.quote, b.page, haystack, pageCount, stats)
      // Pass-through question: a short follow-up the teacher could ask the
      // student about the same passage. Capped at 240 chars; longer = wasted.
      let question: string | null = null
      if (typeof b.question === 'string') {
        const trimmed = b.question.trim()
        if (trimmed.length >= 8) question = trimmed.slice(0, 240)
      }
      // Validate criterion_id against the snapshot; drop hallucinated ids.
      let criterion_id: string | null = null
      if (typeof b.criterion_id === 'string' && validCriterionIds.has(b.criterion_id)) {
        criterion_id = b.criterion_id
      }
      // Tier-3: severity/action/correction. All optional and validated against
      // a fixed enum so a hallucinated value just falls back to null instead
      // of breaking the renderer's switch.
      const severity = normaliseSeverity(b.severity)
      const action   = normaliseAction(b.action)
      let correction: string | null = null
      if (typeof b.correction === 'string') {
        const trimmed = b.correction.trim()
        if (trimmed.length >= 4) correction = trimmed.slice(0, 240)
      }
      return { text, quote, page, question, criterion_id, severity, action, correction }
    })
    .filter((b): b is BulletItem => b !== null)
}

function normaliseSeverity(raw: unknown): BulletSeverity | null {
  if (raw === 'critical' || raw === 'substantial' || raw === 'minor') return raw
  return null
}

function normaliseAction(raw: unknown): BulletAction | null {
  if (raw === 'flag' || raw === 'verify') return raw
  return null
}

/**
 * Pull a bullet's text out of whatever the model returned. We've seen the
 * model occasionally wrap the text in nested objects (e.g. {text: {value: "…"}})
 * or use alternative key names. Naive String() on an object would have stored
 * "[object Object]" — drop those bullets entirely instead.
 */
function extractBulletText(b: unknown): string {
  if (typeof b === 'string') return b.trim()
  if (!b || typeof b !== 'object') return ''
  const obj = b as Record<string, unknown>
  // Try the canonical key plus a few alternatives the model has been seen
  // to use when it ignores the schema.
  for (const key of ['text', 'description', 'point', 'name', 'value', 'content']) {
    const v = obj[key]
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed) return trimmed
    } else if (v && typeof v === 'object') {
      // One level of nesting (e.g. {text: {text: "..."}}).
      const inner = v as Record<string, unknown>
      for (const innerKey of ['text', 'description', 'value']) {
        const iv = inner[innerKey]
        if (typeof iv === 'string') {
          const trimmed = iv.trim()
          if (trimmed) return trimmed
        }
      }
    }
  }
  return ''
}

/**
 * Validate verification questions. Same citation contract as bullets: a quote
 * is accepted only if it appears verbatim (case- and whitespace-insensitive)
 * in the submission. Caps at 4 questions — 2-3 is the sweet spot, anything more
 * dilutes the signal.
 */
export function normaliseVerificationQuestions(
  raw: Array<string | { question?: string; quote?: string | null; page?: number | null }>,
  submissionText: string,
  pageCount: number,
): VerificationQuestion[] {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  return raw
    .map((q): VerificationQuestion | null => {
      const question = (typeof q === 'string' ? q : String(q.question ?? '')).trim()
      if (!question || question.length < 4) return null
      if (typeof q === 'string') {
        return { question, quote: null, page: null }
      }
      const { quote, page } = validateCitation(q.quote, q.page, haystack, pageCount)
      return { question, quote, page }
    })
    .filter((q): q is VerificationQuestion => q !== null)
    .slice(0, 4)
}

/**
 * Per-grading tally of what happened to every quote the model was asked for.
 *
 * Without this, a bullet arriving with `quote: null` is indistinguishable
 * between "the model never offered one" and "it offered one that failed
 * verbatim validation" — and those have opposite fixes (tighten the prompt vs
 * loosen the matcher for hyphenation/OCR noise). Measured on a real 30-work
 * corpus, only ~15% of bullets carried a surviving quote, so knowing which
 * half of that is omission decides where the work goes.
 */
export interface CitationStats {
  absent:           number   // model returned no quote at all
  accepted:         number   // quote verified verbatim against the submission
  rejectedNotFound: number   // quote supplied but absent from the submission (hallucinated/paraphrased)
  rejectedTooShort: number   // quote supplied but under the 8-char floor
}

export function newCitationStats(): CitationStats {
  return { absent: 0, accepted: 0, rejectedNotFound: 0, rejectedTooShort: 0 }
}

function validateCitation(
  rawQuote: unknown,
  rawPage:  unknown,
  haystack: string,
  pageCount: number,
  stats?: CitationStats,
): { quote: string | null; page: number | null } {
  let quote: string | null = null
  if (typeof rawQuote === 'string' && rawQuote.trim()) {
    const trimmed = rawQuote.trim()
    const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ').trim()
    // Accept the quote only if it shows up verbatim (case- and whitespace-insensitive).
    if (normalised.length < 8) {
      if (stats) stats.rejectedTooShort++
    } else if (haystack.includes(normalised)) {
      quote = trimmed.slice(0, 200)
      if (stats) stats.accepted++
    } else {
      if (stats) stats.rejectedNotFound++
    }
  } else if (stats) {
    stats.absent++
  }
  let page: number | null = null
  if (typeof rawPage === 'number' && Number.isInteger(Math.round(rawPage))) {
    const p = Math.round(rawPage)
    if (p >= 1 && p <= pageCount) page = p
  }
  return { quote, page }
}

// ─── Revision helpers ─────────────────────────────────────────────────────────

function buildRevisionContext(parent: Assignment): string {
  const prevFeedback = parent.approved_feedback ?? parent.ai_feedback ?? ''
  const prevGrade    = parent.approved_grade   ?? parent.ai_grade   ?? '—'
  const prevScore    = parent.approved_score   ?? parent.ai_score   ?? '—'

  // If the teacher composed a доработка handout, that selection is the
  // contract — check exactly those bullets + questions. Otherwise fall back
  // to all approved (or AI) improvements like the old flow.
  const handout = parent.ai_handout
  const improvementsSource: string[] = handout
    ? handout.improvements
    : (parent.approved_improvements ?? parent.ai_improvements ?? []).map((b) => b.text)
  const questionsSource: string[] = handout?.questions ?? []

  const improvementsList = improvementsSource.length
    ? improvementsSource.map((p, i) => `${i + 1}. ${sanitiseForPrompt(p)}`).join('\n')
    : '(в предыдущей версии не было сформулированных пунктов улучшения)'

  const questionsBlock = questionsSource.length > 0
    ? `\n**Вопросы, которые были заданы студенту:**\n${questionsSource.map((q, i) => `${i + 1}. ${sanitiseForPrompt(q)}`).join('\n')}\n`
    : ''

  const handoutContext = handout
    ? `\n(Преподаватель отправил студенту «доработку» — список ниже взят из неё, не из общего отзыва. Проверяйте именно эти пункты.)`
    : ''

  const checkInstructions = [
    'Учитывайте, что это переработка — её следует сравнивать с прошлой версией, а не оценивать «с нуля».',
    'По каждому пункту из списка «что улучшить» выше явно укажите в поле "revision_check", был ли он учтён.',
  ]
  if (questionsSource.length > 0) {
    checkInstructions.push(
      'По каждому вопросу из списка «вопросы» выше укажите в поле "question_responses", был ли он отвечен в текущей версии работы.'
    )
  }

  return `## Контекст: предыдущая версия работы
Это переработанная версия (revision). Студент уже сдавал предыдущий вариант, и был дан следующий отзыв:${handoutContext}

**Предыдущая оценка:** ${prevGrade} (${prevScore}/100)

**Общий отзыв на прошлую версию:**
${sanitiseForPrompt(prevFeedback)}

**Что было предложено улучшить в прошлой версии:**
${improvementsList}
${questionsBlock}
При оценке текущей версии:
${checkInstructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

`
}

function normaliseRevisionCheck(raw: unknown): Array<{ point: string; status: 'addressed' | 'partial' | 'not_addressed'; note: string }> | null {
  if (!Array.isArray(raw)) return null
  const valid = ['addressed', 'partial', 'not_addressed'] as const
  type Status = typeof valid[number]
  return raw
    .map((item) => {
      const i = item as { point?: unknown; status?: unknown; note?: unknown }
      const status = String(i.status ?? '').trim() as Status
      return {
        point:  String(i.point  ?? '').trim(),
        status: valid.includes(status) ? status : 'partial' as Status,
        note:   String(i.note   ?? '').trim(),
      }
    })
    .filter((i) => i.point)
}

function normaliseQuestionResponses(raw: unknown): QuestionResponse[] | null {
  if (!Array.isArray(raw)) return null
  const valid = ['answered', 'partial', 'unanswered'] as const
  type Status = typeof valid[number]
  return raw
    .map((item): QuestionResponse => {
      const i = item as { question?: unknown; status?: unknown; note?: unknown }
      const status = String(i.status ?? '').trim() as Status
      return {
        question: String(i.question ?? '').trim(),
        status:   valid.includes(status) ? status : 'partial' as Status,
        note:     String(i.note ?? '').trim(),
      }
    })
    .filter((q) => q.question)
}

function applyWatermark(feedback: string, planTier: string): string {
  if (!canUseFeature(planTier, 'watermark')) return feedback
  return feedback + '\n\n---\nСгенерировано с ИСПУМ (бесплатный тариф) · ispum.ru'
}

// ─── Approve ─────────────────────────────────────────────────────────────────

export async function approve(
  id: string,
  teacherId: string,
  data: {
    approvedScore: number
    approvedGrade: GradeLetter
    approvedFeedback: string
    approvedStrengths?: BulletItem[]
    approvedImprovements?: BulletItem[]
    approvedCriteriaScores?: CriterionScore[]
    approvedEditReason?: import('../../../shared/types').ApprovedEditReason
    approvedBrsCheckpointId?: string | null
  }
): Promise<Assignment> {
  const assignment = await approveAssignment(id, teacherId, data)
  if (!assignment) throw new NotFoundError('Работа')

  generateAndStoreEmbedding(id, assignment.submission_text).catch(() => null)
  if (assignment.course_id && data.approvedCriteriaScores?.length) {
    generateCriterionEmbeddings(id, teacherId, assignment.course_id, data.approvedCriteriaScores).catch(() => null)
  }
  if (assignment.course_id) {
    maybeRegeneratePolicyMemo(assignment.course_id, teacherId).catch(() => null)
  }
  syncGradeToLtiGradebook(assignment).catch(() => null)

  return assignment
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildExamplesBlock(examples: SimilarAssignment[]): string {
  if (examples.length === 0) return ''

  const items = examples
    .map(
      (ex, i) => `### Пример ${i + 1}${ex.contrastive ? ' (пример с другой оценкой — для контраста, чтобы прочувствовать границу между уровнями)' : ''}
Работа студента (фрагмент):
${ex.submission_text.slice(0, 600)}${ex.submission_text.length > 600 ? '…' : ''}

Оценка преподавателя: ${ex.approved_grade} (${ex.approved_score}/100)
Отзыв преподавателя: ${ex.approved_feedback}`
    )
    .join('\n\n---\n\n')

  return `## Примеры оценённых работ по этому предмету
Используйте их как ориентир для калибровки своей оценки.

${items}

`
}

/**
 * Renders the distilled per-course policy memo (patterns in how this teacher
 * corrects the AI draft) as a calibration note ahead of the submission.
 */
/**
 * Render one criterion's teacher-authored level anchors, highest grade first.
 * Returns '' when the teacher hasn't set any, so the prompt is byte-identical
 * to the pre-migration-096 shape for criteria without descriptors.
 */
export function buildLevelDescriptorLines(
  descriptors: CriterionLevelDescriptors | null | undefined,
): string {
  if (!descriptors) return ''
  const lines = GRADES
    .filter((g) => typeof descriptors[g] === 'string' && descriptors[g]!.trim())
    .map((g) => `    «${g}» — ${sanitiseForPrompt(descriptors[g]!.trim())}`)
  if (lines.length === 0) return ''
  return `  Уровни по этому критерию (что соответствует какой оценке):\n${lines.join('\n')}`
}

function buildPolicyMemoBlock(memo: string | null | undefined): string {
  if (!memo) return ''
  return `## Особенности оценивания этого преподавателя
${sanitiseForPrompt(memo)}

`
}

const CALC_GUIDANCE =
  `\nЭто расчётная/инженерная задача. Пересчитайте решение пошагово, проверьте формулы, ` +
  `единицы измерения, размерности и числовой ответ. За верный метод с арифметической опиской ` +
  `начисляйте частичный балл.\n` +
  `ОБЯЗАТЕЛЬНО в полях "feedback", "strengths" и "improvements" разберите КОНКРЕТНЫЕ формулы и расчёты: ` +
  `назовите проверенные формулы по их обозначениям (например, «уравнение теплового баланса Q = G·c·ΔT», ` +
  `«средняя логарифмическая разность температур», «проверка прочности корпуса по σ = p·D/(2·s)»), ` +
  `укажите подставленные значения с единицами и итоговые числовые результаты, отметьте, какие из них ` +
  `сходятся с эталоном, а где расхождения и почему. Общая оценка без таких конкретных ссылок на формулы ` +
  `и числа считается неполной и должна быть переписана.\n`

const REVISION_FIELD_INSTRUCTION =
  `- "revision_check": массив объектов по каждому пункту из списка «что было предложено улучшить» в прошлой версии. ` +
  `Каждый объект: {"point": исходный пункт прошлой версии, "status": "addressed" | "partial" | "not_addressed", "note": 1-2 предложения с обоснованием — что именно изменилось/не изменилось}. ` +
  `Включите КАЖДЫЙ пункт из прошлой версии, даже если он полностью учтён.`

// Question-responses field instruction — only included when the parent had a
// handout with questions. Kept separate from REVISION_FIELD_INSTRUCTION so we
// only ask the model for question_responses when there's something to check.
const QUESTION_RESPONSES_INSTRUCTION =
  `- "question_responses": массив объектов по каждому из «вопросов, которые были заданы студенту» выше. ` +
  `Каждый объект: {"question": исходный вопрос, "status": "answered" | "partial" | "unanswered", "note": 1-2 предложения о том, ответил ли студент в этой версии работы и насколько полно}. ` +
  `Включите КАЖДЫЙ вопрос, даже если ответ полный.`

// Quote requirement, shared by every quote-bearing field in both prompt
// variants.
//
// This used to read «Не выдумывайте цитаты — лучше null» ("don't invent quotes
// — null is better"), which is an opt-out: measured on a real 30-work corpus,
// only ~15% of strengths/improvements arrived with a surviving quote, so ~85%
// of what the teacher read had no anchor in the work at all. The anti-
// hallucination framing was doing its job too well — the model took the safe
// path and omitted.
//
// The fix is to invert the default without inviting fabrication: demand a
// verbatim quote, tell the model the quote is machine-checked, and — crucially
// — instruct it to SWAP THE POINT for one it can ground rather than drop the
// quote. validateCitation stays the safety net (Non-Negotiable #2), which is
// what makes demanding quotes safe rather than reckless.
//
// The `null` escape hatch survives deliberately for absence-type findings ("no
// methodology section") — you cannot quote what isn't in the work, and
// pressuring the model to try is exactly how fabrication starts.
const QUOTE_RULE =
  `Цитату копируйте из работы ДОСЛОВНО, посимвольно — не пересказывайте, не исправляйте и не сокращайте её. ` +
  `Цитаты проверяются автоматически по тексту работы: неточная цитата отбрасывается, и пункт остаётся без подтверждения. ` +
  `Если для пункта не находится дословного подтверждения — замените сам пункт на другой, который вы можете подтвердить цитатой, а не ставьте null. ` +
  `null допустим только для замечаний об ОТСУТСТВИИ чего-либо в работе (нет раздела, нет источников) — то, чего в тексте нет, процитировать нельзя.`

// Verification questions field — present in both prompt variants. The intent
// is "ask the student to verify they understand their own writing", NOT to
// accuse — phrasing should be a neutral pedagogical probe.
function verificationFieldInstruction(pageInstruction: string): string {
  return `- "verification_questions": ОБЯЗАТЕЛЬНОЕ поле. Массив из 2–3 коротких вопросов, которые преподаватель мог бы задать студенту, чтобы убедиться, что студент понимает собственную работу — обоснование выбора метода, источник данных, интерпретация конкретного фрагмента. Никогда не оставляйте массив пустым: даже на отличной работе есть что уточнить устно. Избегайте обвинительных формулировок («признайтесь, что использовали ИИ») — это пробные вопросы для устной проверки понимания, а не обвинения. КАЖДЫЙ объект: {"question": конкретный вопрос на русском (требующий живого, неподготовленного ответа), "quote": ДОСЛОВНАЯ цитата из работы студента (5–12 слов) — фрагмент, к которому относится вопрос, либо null, "page": ${pageInstruction}}`
}

function buildCriteriaPrompt(
  text: string,
  snapshot: CriteriaSnapshotItem[],
  examples: SimilarAssignment[],
  policyMemo?: string | null,
  isCalc = false,
  isRevision = false,
  pageCount = 0,
  hasHandoutQuestions = false,
  criterionExamples?: Record<string, CriterionExample[]>,
): string {
  const criteriaBlock = snapshot
    .map((c) => {
      const base = `- [id: ${c.criterion_id ?? 'null'}] ${c.name} (вес: ${c.weight}%)${c.description ? `: ${sanitiseForPrompt(c.description)}` : ''}`
      const parts = [base]
      // Teacher-authored level anchors (migration 096). Without them the model
      // infers what a «5» means for this criterion from its name alone, which
      // is a major source of both score noise and generic feedback.
      const levels = buildLevelDescriptorLines(c.level_descriptors)
      if (levels) parts.push(levels)
      const matches = criterionExamples?.[c.name.toLowerCase().trim()]
      if (matches?.length) {
        const snippets = matches
          .map((m) => `«${m.feedback.slice(0, 200)}${m.feedback.length > 200 ? '…' : ''}» (${m.score}/100)`)
          .join('; ')
        parts.push(`  Похожие прошлые оценки по этому критерию: ${snippets}`)
      }
      return parts.join('\n')
    })
    .join('\n')

  const anyLevels = snapshot.some((c) => buildLevelDescriptorLines(c.level_descriptors))

  // The criterion-id linking hint is only meaningful when criteria have ids
  // (holistic mode hits this code path with no snapshot at all, but criteria
  // mode might also have legacy items without ids).
  const haveIds = snapshot.some((c) => !!c.criterion_id)
  const criterionIdHint = haveIds
    ? `Каждый объект в "strengths" и "improvements" ОБЯЗАТЕЛЬНО получает поле "criterion_id" — это id критерия из списка выше, к которому пункт ОТНОСИТСЯ. Если пункт связан сразу с несколькими — выберите ОСНОВНОЙ. Если ни с одним — null.`
    : ''

  const pageInstruction = pageCount > 1
    ? `номер страницы из маркера [стр. N], если фрагмент с этой страницы (целое число 1–${pageCount}); иначе null`
    : `всегда null (работа однострочная, без страниц)`
  // Only warn against echoing page markers when there *are* page markers —
  // otherwise the warning is the only place "[стр." shows up in the prompt.
  const markerWarning = pageCount > 1
    ? ` Маркеры [стр. N] в цитату НЕ ВКЛЮЧАЙТЕ.`
    : ''

  // Only stated when at least one criterion actually carries anchors —
  // otherwise it would point at a section of the prompt that isn't there.
  const levelsInstruction = anyLevels
    ? `\nДля критериев, где указаны уровни, определяйте балл по НИМ, а не по общему впечатлению: найдите уровень, которому работа соответствует фактически, и в "feedback" по критерию назовите, какой это уровень и чего не хватает до следующего.`
    : ''

  return `${buildPolicyMemoBlock(policyMemo)}${buildExamplesBlock(examples)}## Критерии оценки

${criteriaBlock}
${levelsInstruction}

## Работа студента${pageCount > 1 ? ` (страницы помечены маркерами [стр. N])` : ''}
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция${isCalc ? CALC_GUIDANCE : ''}
Оцените работу по каждому из перечисленных критериев. Верните JSON-объект со следующими полями:
- "score": итоговый взвешенный балл от 0 до 100
- "grade": одно из "5", "4", "3", "2"  (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": массив объектов по каждому критерию выше. КАЖДЫЙ объект:
    {"name": точное название критерия,
     "score": число 0–100,
     "feedback": обоснование оценки: сначала что именно в работе вы увидели (с опорой на цитату), затем как это соотносится с описанием критерия и его уровнями, затем вывод о балле (3–5 предложений),
     "quote": ОБЯЗАТЕЛЬНОЕ поле — ДОСЛОВНАЯ цитата из работы студента (5–12 слов), на которую опирается ваш вывод по этому критерию,
     "page": ${pageInstruction}}${markerWarning} ${QUOTE_RULE}
${verificationFieldInstruction(pageInstruction)}
- "strengths": массив из 3–5 конкретных достоинств. КАЖДЫЙ объект:
    {"text": конкретное достоинство — что именно сделано хорошо и почему это существенно для этой работы (1–2 предложения, без общих формулировок вроде «хорошая структура»),
     "quote": ОБЯЗАТЕЛЬНОЕ поле — ДОСЛОВНАЯ цитата из работы студента (5–12 слов), подтверждающая этот пункт,
     "page": ${pageInstruction},
     "criterion_id": ${haveIds ? 'id критерия из списка выше, к которому относится пункт; null если ни к какому' : 'всегда null'}}${markerWarning} ${QUOTE_RULE}
- "improvements": массив из 3–5 конкретных областей для улучшения. КАЖДЫЙ объект:
    {"text": что именно улучшить И как — конкретное действие, применимое к этой работе, а не общий совет (1–2 предложения),
     "quote": ОБЯЗАТЕЛЬНОЕ поле — ДОСЛОВНАЯ цитата из работы: фрагмент, который требует доработки (null только если замечание об отсутствии чего-либо),
     "page": ${pageInstruction},
     "criterion_id": ${haveIds ? 'id критерия из списка выше, к которому относится пункт; null если ни к какому' : 'всегда null'},
     "question": ОБЯЗАТЕЛЬНО заполните — ОДИН конкретный вопрос, который преподаватель может задать студенту по этому пункту. Вопрос должен требовать живого ответа, который сложно подготовить заранее, и быть привязан к конкретному фрагменту или утверждению, а не общим. Никогда не оставляйте это поле пустым или null.}${markerWarning} ${QUOTE_RULE}${criterionIdHint ? `\n${criterionIdHint}` : ''}${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}${hasHandoutQuestions ? `\n${QUESTION_RESPONSES_INSTRUCTION}` : ''}

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
}

function buildHolisticPrompt(
  text: string,
  examples: SimilarAssignment[],
  policyMemo?: string | null,
  isCalc = false,
  isRevision = false,
  pageCount = 0,
  hasHandoutQuestions = false,
): string {
  const pageInstruction = pageCount > 1
    ? `номер страницы из маркера [стр. N], если фрагмент с этой страницы (целое число 1–${pageCount}); иначе null`
    : `всегда null (работа однострочная, без страниц)`
  const markerWarning = pageCount > 1
    ? ` Маркеры [стр. N] в цитату НЕ ВКЛЮЧАЙТЕ.`
    : ''

  return `${buildPolicyMemoBlock(policyMemo)}${buildExamplesBlock(examples)}## Работа студента${pageCount > 1 ? ` (страницы помечены маркерами [стр. N])` : ''}
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция${isCalc ? CALC_GUIDANCE : ''}
Оцените работу в целом по академическим стандартам. Верните JSON-объект со следующими полями:
- "score": итоговый балл от 0 до 100
- "grade": одно из "5", "4", "3", "2"  (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке. Разбирайте КОНКРЕТНОЕ содержание этой работы — тезисы, доводы, данные, выводы автора, — а не общие свойства текста. Формулировки, которые подошли бы к любой работе по теме, не годятся.
- "criteria_scores": [] (пустой массив — без критериев)
${verificationFieldInstruction(pageInstruction)}
- "strengths": массив из 3–5 конкретных достоинств. КАЖДЫЙ объект:
    {"text": конкретное достоинство — что именно сделано хорошо и почему это существенно для этой работы (1–2 предложения, без общих формулировок вроде «хорошая структура»),
     "quote": ОБЯЗАТЕЛЬНОЕ поле — ДОСЛОВНАЯ цитата из работы студента (5–12 слов), подтверждающая этот пункт,
     "page": ${pageInstruction}}${markerWarning} ${QUOTE_RULE}
- "improvements": массив из 3–5 конкретных областей для улучшения. КАЖДЫЙ объект:
    {"text": что именно улучшить И как — конкретное действие, применимое к этой работе, а не общий совет (1–2 предложения),
     "quote": ОБЯЗАТЕЛЬНОЕ поле — ДОСЛОВНАЯ цитата из работы: фрагмент, который требует доработки (null только если замечание об отсутствии чего-либо),
     "page": ${pageInstruction},
     "question": ОБЯЗАТЕЛЬНО заполните — ОДИН конкретный вопрос к студенту по этому пункту, требующий живого ответа, который сложно подготовить заранее. Вопрос привязан к конкретному утверждению, не общий. Никогда не оставляйте поле пустым или null.}${markerWarning} ${QUOTE_RULE}${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}${hasHandoutQuestions ? `\n${QUESTION_RESPONSES_INSTRUCTION}` : ''}

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Math.max(0, Math.min(100, isNaN(num) ? 0 : num))
}

function normaliseGrade(g: unknown): GradeLetter {
  const valid: GradeLetter[] = ['5', '4', '3', '2']
  const s = String(g).trim() as GradeLetter
  return valid.includes(s) ? s : '2'
}

function gradeToLabel(g: GradeLetter): string {
  return (
    { '5': 'Отлично', '4': 'Хорошо', '3': 'Удовлетворительно', '2': 'Неудовлетворительно' }[g] ??
    'Неизвестно'
  )
}
