import { chatJSON, embed, type CallContext } from './deepseek'
import { getActiveProviderName } from './llm/registry'
import { gradeEnsemble } from './confidence'
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
import { sanitiseForCrossTeacherRetrieval } from '../lib/crossTeacherSanitiser'
import { generateAndStoreEmbedding } from './embeddings'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { getPolicyMemo } from '../db/queries/policyMemos'
import { maybeRegeneratePolicyMemo } from './policyMemo'
import { verifyCalculation, toImprovementBullet } from './calcVerifier'
import { checkCitations, toCitationBullet } from './citationChecker'
import { canUseFeature } from '../config/planLimits'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type { Assignment, GradeLetter, CriterionScore, CriteriaSnapshotItem, BulletItem, BulletSeverity, BulletAction, VerificationQuestion, QuestionResponse, CalcStepVerdict, CitationVerdict } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeParams {
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
      max_score:    100,
    } as CriteriaSnapshotItem & { max_score: number }
  })
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

async function retrieveExamples(
  submissionText: string,
  courseId: string,
  teacherId: string
): Promise<SimilarAssignment[]> {
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

    return sanitised
  } catch (err) {
    logger.warn({ message: '[RAG] Could not retrieve similar examples', error: (err as Error).message })
    return []
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
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat'
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

  const user = revisionBlock + assignmentContext + reference + (params.criteria.length > 0
    ? buildCriteriaPrompt(annotated, params.criteria, params.examples, params.policyMemo, isCalc, isRevision, pageCount, hasHandoutQuestions)
    : buildHolisticPrompt(annotated, params.examples, params.policyMemo, isCalc, isRevision, pageCount, hasHandoutQuestions))

  return { system, user, pageCount }
}

/** One grading call: prompt → model → normalised result. No DB writes. */
export async function gradeOnce(params: GradeOnceParams): Promise<GradeOnceResult> {
  const { system, user, pageCount } = buildGradingMessages(params)
  const isCalc = params.assignmentType === 'calculation'

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'результат оценивания',
    {
      context:          params.context,
      reasoner:         isCalc,
      temperature:      params.temperature,
      providerOverride: params.providerOverride,
    },
  )

  const grade = normaliseGrade(result.grade)
  let strengths    = normaliseBullets(result.strengths ?? [], params.submissionText, pageCount, params.criteria)
  let improvements = normaliseBullets(result.improvements ?? [], params.submissionText, pageCount, params.criteria)

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

  return {
    score:          clampScore(result.score),
    grade,
    gradeLabel:     result.grade_label ?? gradeToLabel(grade),
    feedback:       result.feedback ?? '',
    criteriaScores:        normaliseCriteriaScores(result.criteria_scores ?? [], params.submissionText, pageCount),
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
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat',
): Promise<{ strengths: BulletItem[]; improvements: BulletItem[] }> {
  if (strengths.length === 0 && improvements.length === 0) return { strengths, improvements }

  const listBlock = (kind: 'strength' | 'improvement', items: BulletItem[]) =>
    items.map((b, i) => `[${kind} ${i}] ${b.text}`).join('\n')

  const system = `Вы — строгий редактор обратной связи по студенческим работам. Ваша задача — проверить каждый пункт отзыва на два критерия: ` +
    `(1) ОБОСНОВАННОСТЬ — утверждение действительно подтверждается текстом работы, а не общими словами; ` +
    `(2) КОНКРЕТНОСТЬ — пункт говорит, что именно сделано хорошо/плохо и (для improvements) что конкретно изменить, а не общая фраза вроде «слабая аргументация». ` +
    `Для каждого пункта верните вердикт: "keep" (уже хорош), "rewrite" (перепишите короче и конкретнее, сохраняя суть) или "drop" (пункт не по существу, ничем не обоснован). ` +
    `Отвечайте только валидным JSON.`

  const user = `## Работа студента (фрагмент)\n${sanitiseForPrompt(submissionText).slice(0, 4000)}\n\n` +
    `## Пункты отзыва для проверки\n${listBlock('strength', strengths)}\n${listBlock('improvement', improvements)}\n\n` +
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
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  assignmentContext?: string
  persona?:       GradingPersona
  temperature?:   number
  context:        CallContext
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat'
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
  const criteriaBlock = params.criteria.length > 0
    ? `\n## Критерии\n${params.criteria.map((c) => `- ${c.name} (вес ${c.weight}%)`).join('\n')}\n`
    : ''
  const examplesBlock = params.examples.length > 0
    ? `\n## Примеры оценок по предмету (ориентир)\n${params.examples
        .map((e) => `${e.approved_grade} (${e.approved_score}/100)`).join(', ')}\n`
    : ''

  const user =
    `${criteriaBlock}${examplesBlock}${assignmentContext}${reference}\n## Работа студента\n<submission>\n` +
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

  return { score: clampScore(result.score), grade: normaliseGrade(result.grade) }
}

// ─── Grade (production path: resolve inputs → gradeOnce → persist) ───────────

export async function grade(params: GradeParams): Promise<GradeResponse> {
  const ragEnabled = canUseFeature(params.planTier, 'ragFlywheel')
  const ids     = params.criterionIds ?? []
  const weights = params.weights ?? []

  const [snapshot, examples, parent, policyMemo] = await Promise.all([
    resolveCriteriaSnapshot(params.teacherId, params.institutionId ?? null, ids, weights),
    ragEnabled && params.courseId
      ? retrieveExamples(params.submissionText, params.courseId, params.teacherId)
      : Promise.resolve([]),
    params.parentAssignmentId
      ? findAssignmentById(params.parentAssignmentId, params.teacherId)
      : Promise.resolve(null),
    ragEnabled && params.courseId
      ? getPolicyMemo(params.courseId)
      : Promise.resolve(null),
  ])

  const gradeParams = {
    submissionText:    params.submissionText,
    criteria:          snapshot,
    examples,
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
  }

  // "Thorough" mode runs the confidence ensemble: the primary call still
  // provides the full feedback, plus cheap score-only samples whose
  // disagreement yields a confidence label. Revisions skip it — the
  // revision-check flow is its own thing and ensemble adds little there.
  const ensemble = params.thorough && parent == null
    ? await gradeEnsemble(gradeParams)
    : null
  const result = ensemble ? ensemble.primary : await gradeOnce(gradeParams)

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
    aiScore: result.score,
    aiGrade: result.grade,
    aiGradeLabel: result.gradeLabel,
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
  pageCount: number
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
    const validated = validateCitation(s.quote, s.page, haystack, pageCount)
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
        return { text, quote: null, page: null, question: null, criterion_id: null }
      }
      const { quote, page } = validateCitation(b.quote, b.page, haystack, pageCount)
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

function validateCitation(
  rawQuote: unknown,
  rawPage:  unknown,
  haystack: string,
  pageCount: number,
): { quote: string | null; page: number | null } {
  let quote: string | null = null
  if (typeof rawQuote === 'string') {
    const trimmed = rawQuote.trim()
    if (trimmed) {
      const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ').trim()
      // Accept the quote only if it shows up verbatim (case- and whitespace-insensitive).
      if (normalised.length >= 8 && haystack.includes(normalised)) {
        quote = trimmed.slice(0, 200)
      }
    }
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
  }
): Promise<Assignment> {
  const assignment = await approveAssignment(id, teacherId, data)
  if (!assignment) throw new NotFoundError('Работа')

  generateAndStoreEmbedding(id, assignment.submission_text).catch(() => null)
  if (assignment.course_id) {
    maybeRegeneratePolicyMemo(assignment.course_id, teacherId).catch(() => null)
  }

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
): string {
  const criteriaBlock = snapshot
    .map((c) => `- [id: ${c.criterion_id ?? 'null'}] ${c.name} (вес: ${c.weight}%)${c.description ? `: ${c.description}` : ''}`)
    .join('\n')

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

  return `${buildPolicyMemoBlock(policyMemo)}${buildExamplesBlock(examples)}## Критерии оценки

${criteriaBlock}

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
     "feedback": краткое обоснование оценки (2–4 предложения),
     "quote": ДОСЛОВНАЯ цитата из работы студента (5–12 слов), на которую опирается ваш вывод — используйте её ТОЛЬКО если в работе действительно есть такой фрагмент. Если опереть вывод не на что — null,
     "page": ${pageInstruction}}${markerWarning} Не выдумывайте цитаты — лучше null, чем неточная цитата.
${verificationFieldInstruction(pageInstruction)}
- "strengths": массив из 3–5 конкретных достоинств. КАЖДЫЙ объект:
    {"text": конкретное достоинство (1 предложение),
     "quote": ДОСЛОВНАЯ цитата из работы студента (5–12 слов), которая подтверждает этот пункт. Используйте ТОЛЬКО если в работе есть такой фрагмент; иначе null,
     "page": ${pageInstruction},
     "criterion_id": ${haveIds ? 'id критерия из списка выше, к которому относится пункт; null если ни к какому' : 'всегда null'}}${markerWarning} Не выдумывайте цитаты — лучше null.
- "improvements": массив из 3–5 конкретных областей для улучшения. КАЖДЫЙ объект:
    {"text": пункт что улучшить (1 предложение),
     "quote": ДОСЛОВНАЯ цитата из работы — фрагмент, который требует доработки, либо null,
     "page": ${pageInstruction},
     "criterion_id": ${haveIds ? 'id критерия из списка выше, к которому относится пункт; null если ни к какому' : 'всегда null'},
     "question": ОБЯЗАТЕЛЬНО заполните — ОДИН конкретный вопрос, который преподаватель может задать студенту по этому пункту. Вопрос должен требовать живого ответа, который сложно подготовить заранее, и быть привязан к конкретному фрагменту или утверждению, а не общим. Никогда не оставляйте это поле пустым или null.}${criterionIdHint ? `\n${criterionIdHint}` : ''}${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}${hasHandoutQuestions ? `\n${QUESTION_RESPONSES_INSTRUCTION}` : ''}

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
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": [] (пустой массив — без критериев)
${verificationFieldInstruction(pageInstruction)}
- "strengths": массив из 3–5 конкретных достоинств. КАЖДЫЙ объект:
    {"text": конкретное достоинство (1 предложение),
     "quote": ДОСЛОВНАЯ цитата из работы студента (5–12 слов), которая подтверждает этот пункт. Используйте ТОЛЬКО если в работе есть такой фрагмент; иначе null,
     "page": ${pageInstruction}}${markerWarning} Не выдумывайте цитаты — лучше null.
- "improvements": массив из 3–5 конкретных областей для улучшения. КАЖДЫЙ объект:
    {"text": пункт что улучшить (1 предложение),
     "quote": ДОСЛОВНАЯ цитата из работы, либо null,
     "page": ${pageInstruction},
     "question": ОБЯЗАТЕЛЬНО заполните — ОДИН конкретный вопрос к студенту по этому пункту, требующий живого ответа, который сложно подготовить заранее. Вопрос привязан к конкретному утверждению, не общий. Никогда не оставляйте поле пустым или null.}${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}${hasHandoutQuestions ? `\n${QUESTION_RESPONSES_INSTRUCTION}` : ''}

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
