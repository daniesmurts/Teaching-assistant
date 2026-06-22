// ─── Teacher ──────────────────────────────────────────────────────────────────

export type TeacherRole = 'teacher' | 'institution_admin' | 'platform_admin'
export type PlanTier    = 'free' | 'pro' | 'institution'

export interface PlanState {
  tier:               PlanTier
  expiresAt:          string | null
  autoRenew:          boolean
  renewalFailedAt:    string | null
  gradesUsed:         number
  gradesLimit:        number | null   // null = unlimited
  presentationsUsed:  number
  presentationsLimit: number | null
  topicsUsed:         number
  topicsLimit:        number | null
  quizzesUsed:        number
  quizzesLimit:       number | null
  features: {
    documentUpload:      boolean
    ragFlywheel:         boolean
    emailGeneration:     boolean
    presentationHistory: boolean
    confidenceCheck:     boolean
    verificationQuestions: boolean
    handout:               boolean
  }
}

export interface Teacher {
  id:          string
  email:       string
  name:        string | null
  university:  string | null
  phone:       string | null
  role?:       TeacherRole
  institution_id?: string | null
  // Mirror of the teacher's institution's shared_rag_enabled flag — surfaced
  // here so the Courses page can decide whether to show / enable the "поделиться
  // с кафедрой" toggle without an extra round-trip.
  institution_shared_rag_enabled?: boolean
  created_at:  string
}

export interface AuthResponse {
  token:   string
  teacher: Teacher
  plan:    PlanState
}

// ─── Course ───────────────────────────────────────────────────────────────────

export type CourseLevel =
  | 'undergraduate_1'
  | 'undergraduate_2'
  | 'postgraduate'
  | 'professional'

export interface Course {
  id: string
  teacher_id: string
  name: string
  code: string | null
  level: CourseLevel | null
  syllabus_text: string | null
  share_rag_with_institution: boolean    // opt-in for the kafedra-wide RAG flywheel
  created_at: string
}

// ─── Criterion ────────────────────────────────────────────────────────────────
// A reusable atom of grading. Teachers pick one or more at grading time and
// assign weights inline — weights live only on the assignment snapshot, not
// here.

export type CriterionSubject =
  | 'business' | 'economics' | 'law' | 'medicine'
  | 'engineering' | 'humanities' | 'general'

export interface Criterion {
  id:                    string
  teacher_id:            string | null   // NULL for global templates
  course_id:             string | null
  name:                  string
  description:           string | null
  subject:               CriterionSubject | null
  is_global_template:    boolean
  is_institution_shared: boolean
  created_at:            string
}

// Item shape inside assignments.criteria_snapshot. Weights/scores are filled in
// at grading time; criterion_id is null for the holistic mode.
export interface CriteriaSnapshotItem {
  criterion_id: string | null
  name:         string
  weight:       number          // 0–100, sum across items must be 100
  description:  string | null
  score?:       number
  feedback?:    string
}

// ─── Rubric ───────────────────────────────────────────────────────────────────
// A named preset of (criterion, weight) pairs. Pure convenience: when picked
// at grade time it fills the criteria list + weights, and the teacher can
// still edit before submitting. The grading event never stores a rubric_id —
// only the snapshot of criteria+weights actually used.

export interface RubricItem {
  criterion_id: string
  weight:       number          // 0–100, sum across items must be 100
}

export interface Rubric {
  id:                    string
  teacher_id:            string | null   // NULL for global templates
  course_id:             string | null
  name:                  string
  description:           string | null
  subject:               CriterionSubject | null
  items:                 RubricItem[]
  is_global_template:    boolean
  is_institution_shared: boolean
  created_at:            string
}

// ─── Assignment ───────────────────────────────────────────────────────────────

export type AssignmentStatus = 'pending' | 'approved' | 'sent'
// Russian 5-point scale: 5 (отлично), 4 (хорошо), 3 (удовл.), 2 (неудовл.).
// Type name kept as GradeLetter to avoid churn across imports.
export type GradeLetter = '5' | '4' | '3' | '2'

export interface CriterionScore {
  name: string
  score: number
  feedback: string
  // Citation pointing at the passage the feedback is grounded in. Both fields
  // are optional — quote is a short verbatim fragment from the submission,
  // page is meaningful only when the submission came from a paginated upload.
  quote?: string | null
  page?:  number | null
}

// A strength or improvement bullet, optionally citing the passage it grounds in.
// Same citation contract as CriterionScore — quote is verbatim from the
// submission (validated server-side), page is set only when the submission was
// extracted from a paginated upload.
//
// For improvements bullets the AI may also generate a `question` — a single
// follow-up the teacher could pose to the student about that exact weakness
// (e.g. bullet "Выводы не подкреплены данными" → question "Какие данные легли
// в основу вывода в разделе 3?"). Surfaced inline with a copy button in the
// grading UI. Strengths bullets ignore the field.
//
// `criterion_id` links the bullet to the criterion it relates to (when criteria
// were selected for the grading event). Validated against the snapshot so
// hallucinated ids are dropped. Lets the corpus answer questions like
// "all my improvement bullets about Аргументация" via direct JOIN instead of
// text search.
export interface BulletItem {
  text:          string
  quote?:        string | null
  page?:         number | null
  question?:     string | null
  criterion_id?: string | null
  // Tier-3 (ВКР-only for now). Optional everywhere; regular grading bullets
  // leave these null. severity sorts gaps in the UI; action distinguishes
  // "уверен, что это ошибка → к проверке" from "стоит спросить автора";
  // correction is a 1-sentence "что сделать" hint surfaced below the bullet.
  severity?:   BulletSeverity | null
  action?:     BulletAction   | null
  correction?: string         | null
}

export type BulletSeverity = 'critical' | 'substantial' | 'minor'
export type BulletAction   = 'flag'     | 'verify'

// Why the teacher edited the AI draft. Optional; surfaced as a dropdown next
// to the Approve button only when an edit is detected. Becomes a training
// signal and a queryable corpus dimension when populated.
export type ApprovedEditReason =
  | 'fact_check'        // ИИ ошибся фактически
  | 'tone'              // вопрос интонации / формулировки
  | 'criterion_weight'  // веса критериев распределены иначе
  | 'scale'             // вопрос шкалы оценивания
  | 'scope'             // ИИ отклонился от задания
  | 'other'

// One row in approved_revisions — the audit trail of every approve mutation.
// First approve creates the row in approved_revisions AND fills the columns
// on assignments; subsequent re-approves overwrite the assignments row but
// append a new approved_revisions row, so history is never lost.
export interface ApprovedRevision {
  approved_at:              string
  actor_teacher_id:         string | null
  approved_score:           number | null
  approved_grade:           GradeLetter | null
  approved_feedback:        string | null
  approved_strengths:       BulletItem[] | null
  approved_improvements:    BulletItem[] | null
  approved_criteria_scores: CriterionScore[] | null
  approved_edit_reason:     ApprovedEditReason | null
}

// A question the teacher could ask the student to verify they understand their
// own writing. Generated on every regular grade as a softer alternative to AI-
// detection: instead of accusing, the teacher probes. Grounded in a verbatim
// fragment when possible.
export interface VerificationQuestion {
  question: string
  quote:    string | null
  page:     number | null
}

// ─── Confidence / ensemble ────────────────────────────────────────────────────
// "Thorough" grading runs an ensemble of grader variants and derives a
// calibrated confidence from their disagreement. Low confidence flags a work
// for closer teacher review (selective-prediction / triage).
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface EnsembleSample {
  persona:     'strict' | 'neutral' | 'lenient'
  temperature: number | null
  score:       number
  grade:       GradeLetter
}

export interface AiEnsemble {
  samples:         EnsembleSample[]
  score_std:       number
  score_spread:    number   // max − min
  grade_agreement: number   // fraction of samples matching the modal grade
}

export type RevisionStatus = 'addressed' | 'partial' | 'not_addressed'

export interface RevisionCheckItem {
  point:  string         // the previous-version improvement being checked
  status: RevisionStatus
  note:   string         // 1-sentence justification
}

// Mirror shape for the handout's questions — did the next version's text
// actually answer them? Different status vocabulary because "answered" maps
// more naturally to a question than "addressed".
export type QuestionResponseStatus = 'answered' | 'partial' | 'unanswered'

export interface QuestionResponse {
  question: string                  // the original handout question
  status:   QuestionResponseStatus
  note:     string                  // 1-sentence justification
}

// Snapshot of the last "доработка" the teacher composed for an assignment.
// Stored on the source assignment row; when a revision is linked back to it
// (via parent_assignment_id), this becomes the contract the AI checks against.
export type HandoutTone = 'encouraging' | 'neutral' | 'direct'

export interface Handout {
  improvements: string[]
  questions:    string[]
  subject:      string
  body:         string
  tone:         HandoutTone
  created_at:   string             // ISO
}

export interface Assignment {
  id: string
  teacher_id: string
  course_id: string | null
  student_name: string | null
  student_email: string | null
  student_group: string | null
  submission_text: string
  ai_score: number | null
  ai_grade: GradeLetter | null
  ai_grade_label: string | null
  ai_feedback: string | null
  ai_criteria_scores: CriterionScore[] | null
  ai_strengths: BulletItem[] | null
  ai_improvements: BulletItem[] | null
  ai_verification_questions: VerificationQuestion[] | null  // Pro-tier display gate
  ai_revision_check: RevisionCheckItem[] | null   // present only on revisions
  ai_question_responses: QuestionResponse[] | null  // present only on revisions where parent had a handout
  ai_handout: Handout | null                       // present only when teacher composed one
  criteria_snapshot: CriteriaSnapshotItem[] | null   // the criteria + weights used for this grading
  ai_confidence:     ConfidenceLevel | null       // present only on "thorough" (ensemble) gradings
  ai_ensemble:       AiEnsemble | null            // the variant samples behind the confidence
  ai_provider:       string | null                 // which LLM provider graded this row (Phase 4)
  approved_score: number | null
  approved_grade: GradeLetter | null
  approved_feedback: string | null
  approved_strengths: BulletItem[] | null     // teacher-edited bullet list (null = AI default)
  approved_improvements: BulletItem[] | null  // ditto — feeds the revision check on resubmission
  approved_criteria_scores: CriterionScore[] | null   // teacher-edited per-criterion scores (Phase asset-hardening)
  approved_edit_reason:     ApprovedEditReason | null  // optional taxonomy of WHY the teacher edited
  approved_at: string | null
  status: AssignmentStatus
  parent_assignment_id: string | null              // linked previous version, if any
  revision_number: number                          // 1 = original, 2+ = revision chain
  created_at: string
}

// ─── Long-document review (ВКР / диплом / большие работы) ─────────────────────

// Documents at or below this many characters are graded in a single DeepSeek
// call. Above it, we switch to the section-aware map-reduce review pipeline.
// 120 000 chars ≈ ~34k tokens — comfortably inside DeepSeek's context window,
// leaving room for the rubric, RAG examples and the model's output.
export const SINGLE_PASS_CHAR_LIMIT = 120_000

// Hard ceiling for the review pipeline (a ~300-page ВКР). Beyond this we ask the
// teacher to split the work — quality and cost stop being defensible.
export const MAX_REVIEW_CHARS = 1_000_000

export type LongReviewStatus = 'pending' | 'analyzing' | 'synthesizing' | 'ready' | 'failed'

// Strengths/gaps shape evolved from plain string[] (Tier-0) to BulletItem[]
// (Tier-1, with verbatim quotes from the section). Older rows still carry
// strings inside the JSONB result column — the frontend renderer tolerates
// both, the backend writes only BulletItem now.
export interface ChapterReview {
  title: string
  assessment: string                       // 1–2 paragraphs on this section
  strengths: Array<BulletItem | string>
  gaps:      Array<BulletItem | string>
}

// A committee question grounded in (optionally) a specific chapter / passage.
// Generated as a separate, dedicated call so the main synthesis JSON budget
// doesn't bottleneck it (was happening for long ВКРs — questions silently
// truncated). Older rows may still carry plain string[] for backwards-compat;
// the frontend tolerates both shapes when rendering.
export interface DefenseQuestion {
  question:      string
  chapter_index: number | null   // 0-based index into chapter_reviews
  quote:         string | null   // verbatim fragment from that section
  page:          number | null
}

// A single quantitative claim pulled from one section during analyzeSection.
// `value` is preserved verbatim (units and all — "850 кг/м³", "n=42",
// "до 1 октября 2025") so the cross-section pass can compare meaningfully and
// the teacher sees exactly what the work said. `quote` is a verbatim sentence
// containing the value; `chapter_index` is stamped by the orchestrator after
// section analysis (analyzeSection doesn't know its own index).
export interface KeyQuantity {
  name:          string
  value:         string
  quote:         string
  chapter_index: number
}

// A contradiction detected across sections by the post-synthesis consistency
// pass. `occurrences` carries every conflicting mention (≥2) so the teacher
// can verify directly. `summary` is the model's one-line diagnosis.
export interface Inconsistency {
  name:        string
  occurrences: KeyQuantity[]
  summary:     string
}

// Tier-4: a headline numerical result that the recomputation pass independently
// re-derived from the inputs visible in the work, and compared to the author's
// stated value. Only surfaced when there's a real discrepancy. Severity follows
// the BulletItem taxonomy so the UI styles it consistently with gaps.
//
// `inputs` and `formula` are best-effort context for the teacher to verify the
// re-derivation themselves; both may be null when the work didn't make them
// explicit and the reasoner inferred them.
export interface RecomputationFinding {
  claim:            string             // human-readable label of what was checked
  claimed_value:    string             // author's value, verbatim with units
  recomputed_value: string             // model's independent re-derivation
  discrepancy:      string             // 1 sentence: nature/magnitude of the gap
  inputs:           string | null      // e.g. "ρ=850 кг/м³, v=2 м/с, d=0.1 м"
  formula:          string | null      // e.g. "Re = ρvd/μ"
  quote:            string             // verbatim sentence from the work
  chapter_index:    number
  severity:         BulletSeverity
}

// A document-level finding from the cross-section premise pass (reasoner). Unlike
// Inconsistency (numeric clusters with the same name) and RecomputationFinding
// (arithmetic re-derivation), this catches reasoning that spans sections or
// violates physics/chemistry:
//   • 'contradiction' — an assumption/value in one section contradicts another
//     (e.g. the gas composition vs. the combustion equation three sections later)
//   • 'physical'      — an assumption is physically implausible given known
//     constants (e.g. a component that stays gaseous at the stated p/T)
//   • 'logical'       — a stoichiometric/balance/derivation error within an argument
// `evidence` carries the supporting verbatim quotes (validated against the work);
// 'physical' findings may stand on the explanation alone with zero quotes.
export type PremiseFindingKind = 'contradiction' | 'physical' | 'logical'

export interface PremiseFinding {
  kind:        PremiseFindingKind
  title:       string                                       // short label
  explanation: string                                       // 2–3 sentences: what's wrong and why
  evidence:    Array<{ chapter_index: number; quote: string }>
  severity:    BulletSeverity
  correction:  string                                       // one sentence: what to do
}

export interface LongReviewResult {
  overall_summary:   string
  suggested_score:   number | null
  suggested_grade:   GradeLetter | null
  grade_label:       string | null
  chapter_reviews:   ChapterReview[]
  overall_strengths: Array<BulletItem | string>
  overall_gaps:      Array<BulletItem | string>
  defense_questions: DefenseQuestion[]
  // Coverage note — what was actually verified vs. where evidence was thin.
  // Tier-1 addition. Null on legacy rows. Surfaced as a discreet block under
  // the overall summary so the teacher knows what to spot-check.
  coverage_note:     string | null
  // Tier-2: cross-section quantitative contradictions surfaced by the
  // post-synthesis consistency pass. Empty when nothing was found OR on
  // legacy rows. Frontend hides the whole block when empty.
  inconsistencies:   Inconsistency[]
  // Tier-4: independent recomputation of headline numerical results, run via
  // the DeepSeek reasoner. Empty when nothing was checked (no numeric
  // claims) OR everything matched OR on legacy rows.
  recomputation_findings: RecomputationFinding[]
  // Tier-5: cross-section premise pass (reasoner). Document-level reasoning over
  // all sections at once — catches contradictions that span sections and
  // physically/logically implausible assumptions. Empty when nothing found OR
  // on legacy rows. Frontend hides the block when empty.
  premise_findings: PremiseFinding[]
}

// Returned by POST /api/grading/review and polled via GET /api/grading/review/:id
export interface LongReview {
  id:             string
  status:         LongReviewStatus
  progress_done:  number
  progress_total: number
  assignment_id:  string | null    // set once a draft assignment row is created
  result:         LongReviewResult | null
  error_message:  string | null
  created_at:     string
}

// ─── Topic generator (темы для исследований / практик) ───────────────────────

export type StudentLevel = 'bachelor' | 'specialist' | 'master' | 'postgraduate'
export type TopicWorkType = 'coursework' | 'thesis' | 'internship' | 'pre_diploma' | 'article'

export interface TopicItem {
  title:     string
  rationale: string   // чем ценна / актуальность
  scope:     string   // что предстоит сделать
  site_link?: string  // связь с местом практики (if given)
  outcome?:  string   // ожидаемый результат / новизна
}

export interface TopicSet {
  id:            string
  teacher_id:    string
  course_id:     string | null
  level:         string
  work_type:     string
  field:         string | null
  interests:     string | null
  practice_site: string | null
  student_name:  string | null
  student_group: string | null
  topics:        TopicItem[]
  used_search:   boolean
  created_at:    string
}

// ─── Presentation ─────────────────────────────────────────────────────────────

export type PresentationStyle =
  | 'theory_heavy'
  | 'case_study'
  | 'discussion_based'

// One citation surfaced next to a slide. The model emits inline [N] markers
// in bullets/notes; this list resolves N → the original document, the chunk
// the bullet was grounded in, and (when paginated) the page range. The
// frontend joins [N] to this list to render clickable chips.
export interface PresentationSource {
  idx:         number              // matches the [N] marker in the slide text
  document_id: string
  file_name:   string
  page_start:  number | null
  page_end:    number | null
  excerpt:     string              // first ~280 chars of the chunk, for the popover
  chunk_type:  string | null
}

export interface Presentation {
  id: string
  teacher_id: string
  course_id: string | null
  lecture_number: number | null
  topic: string
  duration_minutes: number | null
  audience_level: string | null
  learning_goals: string[] | null
  style: PresentationStyle | null
  slide_count_target: number | null
  generated_content: string | null
  sources: PresentationSource[] | null
  created_at: string
}

// ─── Quiz (быстрая проверочная по материалам курса) ───────────────────────────

// Difficulty / cognitive level the teacher asked for. Drives the prompt.
export type QuizLevel = 'recall' | 'understanding' | 'application'

export interface QuizQuestion {
  question:      string                // text may contain inline [N] citation markers
  options:       string[]              // length 4
  correct_index: number                // 0-based; which option is correct
  explanation:   string                // 1–2 sentence "why this is correct"
  citations:     number[]              // source idx values, validated against the source list
}

export interface Quiz {
  id:             string
  teacher_id:     string
  course_id:      string | null
  topic:          string
  level:          QuizLevel | null
  question_count: number
  questions:      QuizQuestion[]
  sources:        PresentationSource[] | null
  created_at:     string
}

// ─── Curriculum overlap analysis (Анализ дублирования содержания) ───────────────
// КНИТУ admin feature A3: detect duplicated/overlapping topics across the
// disciplines a single student takes. Topics are extracted per discipline,
// embedded, cross-compared by cosine similarity, then the strongest candidate
// pairs are classified by the model. Computed live — not persisted (MVP).

export type OverlapType = 'duplicate' | 'partial' | 'adjacent'

export interface OverlapPair {
  course_a_id:    string
  course_a_name:  string
  topic_a:        string
  course_b_id:    string
  course_b_name:  string
  topic_b:        string
  similarity:     number          // cosine, 0..1
  overlap_type?:  OverlapType     // model-assigned (absent if classification was skipped)
  note?:          string          // 1-sentence RU explanation of the overlap
  recommendation?: string         // RU suggestion (e.g. разграничить / убрать дубль)
}

export interface AnalyzedDiscipline {
  course_id:   string
  course_name: string
  topic_count: number
}

export interface SkippedDiscipline {
  course_id:   string
  course_name: string
  reason:      string             // RU — why it couldn't be analysed (no content, etc.)
}

export interface DisciplinePairSummary {
  course_a_id:    string
  course_a_name:  string
  course_b_id:    string
  course_b_name:  string
  overlap_count:  number
  max_similarity: number
}

export interface CurriculumAnalysis {
  analyzed:     AnalyzedDiscipline[]
  skipped:      SkippedDiscipline[]
  pairs:        OverlapPair[]            // sorted by similarity desc
  pair_summary: DisciplinePairSummary[]  // per discipline-pair rollup, strongest first
  generated_at: string
}

// ─── Syllabus conformance review (РПД ↔ компетенции/цели) ───────────────────────
// КНИТУ admin feature A2: score how well a syllabus (РПД) covers the ОПК/ПК/УК
// competencies and goals/outcomes it is meant to fulfil. Structurally this is the
// grading engine — each competency/goal is a "criterion", the syllabus is the
// "submission". Competencies/goals are either declared inside the РПД (auto-
// extracted) or supplied by the admin. Computed live — not persisted (MVP).

export type CoverageStatus = 'covered' | 'partial' | 'missing'

// Each requirement extracted from the РПД is one of these kinds. They mirror the
// ФГОС structure: цель → компетенция → индикатор → Знать / Уметь / Владеть.
export type RequirementKind =
  | 'goal'         // Цель освоения (раздел 1)
  | 'competency'   // ОПК / ПК / УК (раздел 3, верхний уровень)
  | 'indicator'    // индикатор достижения компетенции (3.1, 3.2, …)
  | 'knowledge'    // Знать
  | 'skill'        // Уметь
  | 'mastery'      // Владеть

// Content sections of the РПД — *where* evidence of coverage must live. Findings
// cite these, not the requirement section itself.
export type ContentSection = 'lectures' | 'practicals' | 'labs' | 'independent' | 'control'

export interface CoverageSource {
  section:  ContentSection
  excerpt:  string                  // verbatim quote from that content section
}

export interface SyllabusCoverageItem {
  kind:           RequirementKind
  code:           string | null      // 'ОПК-1' / 'ОПК-1.1' / null for free-form goals
  title:          string             // requirement statement
  parent_code?:   string | null      // for indicators — parent competency code
  status:         CoverageStatus
  score:          number             // 0–100 coverage estimate
  sources:        CoverageSource[]   // content sections that actually deliver this (may be empty)
  evidence:       string | null      // legacy single quote — first source.excerpt for back-compat
  gap:            string             // what's missing or weak (1–2 sentences)
  recommendation: string             // concrete fix for the РПД
}

// "Что мы нашли в РПД" — surfaced before the findings so the reviewer can verify
// the structural understanding (есть ли §5, нашли ли Знать/Уметь/Владеть, …).
export interface ParsedSyllabusReport {
  goals_count:        number
  competencies_count: number
  indicators_count:   number
  knowledge_count:    number
  skills_count:       number
  mastery_count:      number
  content_sections:   ContentSection[]   // which content sections were located
}

export interface SyllabusReview {
  competencies_source: 'declared' | 'provided'   // extracted from the РПД vs. supplied
  goals_source:        'declared' | 'provided'
  parsed?:      ParsedSyllabusReport             // structural parse summary
  items:        SyllabusCoverageItem[]
  summary:      string                            // 2–3 sentence overall verdict
  covered:      number
  partial:      number
  missing:      number
  generated_at: string
}

// ─── Материалы — AI practical-material generator (КНИТУ T1) ─────────────────────
// One generator, three kinds: задания (assignment), кейсы (case), проекты (project).
// Shared item shape; the prompt + UI labels differ by kind. Entity is task_sets (the
// `assignments` table holds graded student work). Mirrors TopicSet.

export type MaterialKind = 'assignment' | 'case' | 'project'
export type TaskDifficulty = 'basic' | 'intermediate' | 'advanced'

export interface TaskItem {
  title:     string    // короткое название
  statement: string    // основное содержание: условие / описание ситуации + вопросы / цель и результат
  skills:    string    // какие умения/компетенции развивает (1 строка)
  guidance?: string    // подсказка / разбор / критерии для преподавателя
}

export interface TaskSet {
  id:         string
  teacher_id: string
  course_id:  string | null
  kind:       MaterialKind
  topic:      string
  difficulty: TaskDifficulty
  tasks:      TaskItem[]
  created_at: string
}

// ─── РПД-студия — AI-assisted syllabus authoring (КНИТУ T5) ─────────────────────
// AI drafts/updates syllabus content aimed at target ОПК/ПК/УК + goals. Pairs with
// the SyllabusReview check (above) into a write → check → fix loop. AI drafts, the
// teacher (разработчик РПД) is the author of record. Computed live, not persisted.

export interface SyllabusSection {
  heading: string     // e.g. «Цели освоения дисциплины», «Содержание (темы)»
  content: string     // editable text — paragraphs or newline-separated lines
}

export interface SyllabusDraft {
  mode:         'draft' | 'improve'   // fresh draft vs. revision of existing content
  sections:     SyllabusSection[]
  generated_at: string
}

// ─── API error shape ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}
