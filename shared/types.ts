// ─── Process-of-creation attestation (Research.md §5.1) ───────────────────────

// DERIVED AGGREGATES ONLY — the raw keystroke stream never leaves the browser
// (152-FZ, §5.1.2). Computed client-side, persisted on the invite, surfaced to
// the teacher as transparent facts (§5.1.3) — never an opaque score.
export interface SubmissionTelemetry {
  total_chars:    number   // final length
  active_ms:      number   // active editing time (idle gaps excluded)
  revision_count: number   // count of meaningful edit transactions
  paste_count:    number
  pasted_chars:   number   // total chars introduced by paste
  largest_paste:  number   // largest single insertion (big paste = suspicious)
  started_at:     string   // ISO — first edit
  last_edit_at:   string   // ISO — most recent edit
}

// Provenance facts derived from telemetry — transparent numbers the teacher
// reads alongside the work (§5.1.3). Deliberately NOT a score or verdict; the
// teacher judges, the platform attests.
export interface ProvenanceFacts {
  activeMinutes: number       // active editing time (idle gaps excluded)
  spanMinutes:   number       // wall-clock from first to last edit
  revisionCount: number
  totalChars:    number
  pastedChars:   number
  largestPaste:  number       // largest single insertion
  pasteRatio:    number       // pastedChars / totalChars, 0..1
  startedAt:     string | null
  lastEditAt:    string | null
}

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
    publishedAssignments:  boolean
    feedbackCritic:        boolean
    cohortSynthesis:       boolean
    calcVerification:      boolean
    citationCheck:         boolean
    challengeFeedback:     boolean
  }
}

export interface Teacher {
  id:          string
  email:       string
  name:        string | null
  university:  string | null
  phone:       string | null
  // Deferred email verification (migration 076) — false until the teacher
  // confirms via the link in the welcome/resend email. Drives the in-app
  // banner; never gates login. SSO/LTI/invite accounts are true from birth.
  email_verified?: boolean
  role?:       TeacherRole
  // §7 org-tree-derived admin signals — authoritative for route gating.
  // `role` is retained as a synced mirror; prefer these for access decisions.
  is_platform_admin?:    boolean
  is_institution_admin?: boolean   // holds `admin` on the institution root unit
  is_leader?:            boolean   // platform admin OR holds head/admin on any unit
  // Access class for the «Образовательные программы» surface. Computed from
  // getProgramAccessScope on the server so the sidebar renders without an
  // extra round trip. Details of *which* programs are visible are resolved
  // by the routes themselves.
  program_access?:       'none' | 'all-rw' | 'all-ro' | 'specific'
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
  profession_context: string | null      // направление подготовки / кем работают выпускники — see Research.md §8
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
  // Which provider produced this sample. Omitted (implicitly the
  // institution's default provider) for the primary and same-family
  // secondaries; set explicitly when a secondary is routed to a different
  // provider on purpose to decorrelate ensemble errors.
  provider?:   'deepseek' | 'yandex' | 'qwen'
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

// Agentic calc verification (Feature S) — one entry per extracted
// computational step. 'correct'/'unevaluable' are informational; only
// 'arithmetic_error' entries get merged into ai_improvements as a bullet.
export type CalcStepVerdictStatus = 'correct' | 'arithmetic_error' | 'unevaluable'

export interface CalcStepVerdict {
  step_index:       number
  description:      string
  formula:          string | null
  substitution:     string | null    // numeric expression actually evaluated
  claimed_result:   string
  evaluated_result: number | null    // our independently computed value; null if unevaluable
  verdict:          CalcStepVerdictStatus
  note:             string
}

// Citation existence checking (Feature T) — one entry per extracted
// bibliography reference. Only 'not_found' entries get merged into
// ai_improvements as a bullet; 'similar_found' is kept in the persisted
// raw array only (too uncertain to surface as a finding). Never treat a
// 'not_found' as proof of fabrication — paywalled/offline sources exist.
export type CitationVerdictStatus = 'found' | 'similar_found' | 'not_found'

export interface CitationVerdict {
  index:             number
  raw_text:          string           // the reference as it appears in the submission
  query_used:        string           // what was actually searched (after any reformulation)
  status:            CitationVerdictStatus
  best_match_title:  string | null
  best_match_url:    string | null
  note:              string           // neutral, ≤240 chars
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
  ai_calc_verification: CalcStepVerdict[] | null  // present only for calc-mode gradings with verification enabled
  ai_citation_check: CitationVerdict[] | null      // present only when citation checking was opted into
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
  lti_gradebook_synced_at:  string | null   // set once the grade posts back to the LMS gradebook
  lti_gradebook_sync_error: string | null   // last sync failure, if any (null once a retry succeeds)
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

// Async single-pass grade jobs (grade_jobs table). Regular grading is
// enqueued and polled the same way as long reviews — the calc reasoner
// chain can run for minutes, longer than any sane HTTP timeout.
export type GradeJobStatus = 'pending' | 'processing' | 'ready' | 'failed'

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
  // Feature N: чертежи (drawings) submitted alongside the ПЗ, OCR'd and fed into
  // the inconsistencies (Tier-2) and premise (Tier-5) passes as pseudo-sections
  // appended after chapter_reviews — so text-vs-drawing contradictions (dimension
  // mismatches, mislabeled parts) surface the same way cross-chapter ones do.
  // A finding's `chapter_index` >= chapter_reviews.length refers to
  // drawings[chapter_index - chapter_reviews.length], not a written chapter —
  // this array is what lets the UI tell "Раздел N" from "Чертёж: файл.pdf"
  // apart. Empty on reviews with no uploaded drawings OR on legacy rows.
  drawings: Array<{ title: string }>
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

// ─── Typed slides (new format) ────────────────────────────────────────────────
//
// The model picks `type` per slide based on what the content actually wants
// (a definition vs. a formula vs. a comparison). The frontend renders each
// type with its own layout. Any text field may contain inline $...$ or $$...$$
// LaTeX (rendered with KaTeX) and inline [N] citation markers.

export type SlideType =
  | 'title'
  | 'bullets'
  | 'concept'
  | 'formula'
  | 'comparison'
  | 'diagram'
  | 'discussion'
  | 'summary'

// An image the teacher picked from Yandex Images for a diagram-class slide.
// Stored on the slide itself; never auto-selected — search returns candidates,
// teacher picks one. `source_url` is the page the image lives on (attribution).
export interface SlideImage {
  url:         string        // direct image URL
  source_url:  string        // page that hosts the image (attribution / verify)
  thumbnail:   string        // smaller preview for grid + slide rendering
  width:       number | null
  height:      number | null
  query:       string        // what we searched for
  source_host: string | null // e.g. "wikipedia.org" — shown as the credit
}

interface SlideBase {
  type:      SlideType
  title:     string
  notes:     string          // speaker notes — always present
  citations: number[]        // source idx values referenced anywhere on the slide
}

export interface TitleSlide extends SlideBase {
  type: 'title'
  body: {
    subtitle: string | null    // course / discipline line
    lecturer: string | null    // "[ФИО лектора]" placeholder is fine
  }
}

export interface BulletsSlide extends SlideBase {
  type: 'bullets'
  body: {
    items: string[]            // each item may contain $...$ LaTeX and [N] markers
  }
}

// One concept, defined and unpacked. Better than 5 bullets for a definition.
export interface ConceptSlide extends SlideBase {
  type: 'concept'
  body: {
    definition: string         // one or two sentences
    supporting: string[]       // 2–4 short clarifying points
  }
}

// One or more formulas, with a one-line explanation each.
export interface FormulaSlide extends SlideBase {
  type: 'formula'
  body: {
    formulas: Array<{
      latex:   string          // raw LaTeX, no surrounding $$
      caption: string          // "Полезная мощность насоса" — short label
    }>
    explanation: string | null // optional 1–2 sentence framing
  }
}

// Two columns of comparable items. Good for "X vs Y", classification splits.
export interface ComparisonSlide extends SlideBase {
  type: 'comparison'
  body: {
    columns: Array<{
      header: string
      items:  string[]
    }>                          // length 2 (sometimes 3 — renderer tolerates both)
  }
}

// A diagram / equipment / process image. `imageQuery` is what we'd ask
// Yandex Images. `image` is set after the teacher picks from candidates.
export interface DiagramSlide extends SlideBase {
  type: 'diagram'
  body: {
    image_query: string        // ru search query, e.g. "осевой насос разрез"
    caption:     string        // short caption shown under image
    points:      string[]      // 1–3 supporting bullet points (optional)
    image:       SlideImage | null
  }
}

// A provocative question + facilitation prompts. Drives engagement, not info.
export interface DiscussionSlide extends SlideBase {
  type: 'discussion'
  body: {
    question:        string
    prompts:         string[]  // 2–4 follow-up sub-questions for the lecturer
    expected_angles: string[]  // brief hints in notes-style for the teacher
  }
}

// Closing slide — what we learned + what's next.
export interface SummarySlide extends SlideBase {
  type: 'summary'
  body: {
    takeaways:  string[]
    next_steps: string[]       // pre-reading, next lecture topic, etc.
  }
}

export type Slide =
  | TitleSlide
  | BulletsSlide
  | ConceptSlide
  | FormulaSlide
  | ComparisonSlide
  | DiagramSlide
  | DiscussionSlide
  | SummarySlide

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
  // New (preferred): typed slide array. When non-null the frontend renders
  // from this and ignores `generated_content`.
  slides: Slide[] | null
  // Legacy: original text DSL. Still populated for new rows as a text
  // rendering used by copy-all / fallback. Pre-migration rows have this
  // and `slides = null` — frontend falls back to the text parser.
  generated_content: string | null
  sources: PresentationSource[] | null
  created_at: string
}

// Candidate from a Yandex Images search — pre-pick, before it lives on a slide.
export interface ImageCandidate {
  url:         string
  source_url:  string
  thumbnail:   string
  width:       number | null
  height:      number | null
  source_host: string | null
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

// ─── Cohort synthesis (class-wide insight for a published assignment) ──────────
// Aggregates approved feedback across all graded submissions of one published
// assignment into insight a single per-student grade can't show: recurring
// gaps, the grade spread, standouts, and what to revisit in the next lecture.

export interface CohortGap {
  issue: string   // e.g. "путают корреляцию и причинность"
  count: number   // how many submissions showed this pattern
}

export interface CohortSynthesis {
  common_gaps:        CohortGap[]
  score_distribution: { grade: GradeLetter; count: number }[]
  standout_strengths: string[]
  recommended_topics:  string[]
  based_on_count:      number
  generated_at:        string
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

// ─── "Оспорить" — challenge a piece of AI feedback ───────────────────────────
// Teacher highlights a bullet / criterion / coverage finding they believe is
// wrong or unexpected and asks the model to re-verify against the same source
// text, rather than opening a free-form chat. The model must ground its
// verdict in a fresh verbatim quote — validated server-side the same way
// grading citations are (see validateQuoteAgainstSource in lib/citation.ts) —
// so a teacher's pushback can't just talk the model into caving (sycophancy).

export type ChallengeSourceType =
  | 'grading_bullet'      // BulletItem.text (strengths/improvements)
  | 'grading_criterion'   // CriterionScore.feedback
  | 'grading_question'    // VerificationQuestion.question
  | 'syllabus_coverage'   // SyllabusCoverageItem — Curriculum Studio РПД coverage

export type ChallengeVerdict =
  | 'confirm'   // original claim stands; evidence_quote backs it up (freshly re-verified)
  | 'clarify'   // claim is directionally right but misleading; suggested_text rewords it
  | 'retract'   // claim was wrong; suggested_text is a replacement, or null to just remove it

export interface ChallengeRequest {
  source_type:     ChallengeSourceType
  assignment_id?:  string | null   // grading only — links the challenge to its assignment
  item_ref?:       string | null   // criterion name / coverage item code, for display + audit
  claim_text:      string          // the feedback text being challenged
  claim_quote?:    string | null   // the citation the original claim carried, if any
  source_text:     string          // passage(s) to re-verify against
  objection:       string          // teacher's free-text explanation of what's wrong
}

export interface ChallengeResult {
  verdict:         ChallengeVerdict
  explanation:     string           // shown to the teacher — why the model landed here
  evidence_quote:  string | null    // fresh verbatim quote backing the verdict
  suggested_text:  string | null    // rewritten bullet/finding text when verdict != 'confirm'
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
// teacher (разработчик РПД) is the author of record. Persisted per course
// (syllabus_studio_drafts, migration 070) — the teacher's latest generation and
// any subsequent edits/rechecks survive a refresh.

export interface SyllabusSection {
  heading: string     // e.g. «Цели освоения дисциплины», «Содержание (темы)»
  content: string     // editable text — paragraphs or newline-separated lines
}

export interface SyllabusDraft {
  mode:         'draft' | 'improve'   // fresh draft vs. revision of existing content
  sections:     SyllabusSection[]
  generated_at: string
}

// ─── Academic programs / учебные планы (institution-admin) ──────────────────────
// A department head defines an образовательная программа as an ordered list of
// disciplines across semesters + the ФГОС competencies/goals it must deliver.
// The platform analyses the whole plan: sequencing & prerequisites, competency
// progression, gaps & redundancy, relatedness & load. Persisted (unlike the
// teacher-scoped curriculum tools); the latest analysis is cached.

export type ProgramLevel = 'bachelor' | 'master' | 'specialist'
export type CompetencyKind = 'goal' | 'competency'

export interface ProgramCompetency {
  id?:         string
  kind:        CompetencyKind
  code:        string | null      // 'УК-1' / 'ОПК-2' / 'ПК-3'; null for goals
  title:       string
  sort_order:  number
}

export interface ProgramDiscipline {
  id?:               string
  course_id:         string | null    // optional link to a real РПД-bearing course
  name:              string
  semester:          number           // 1..duration_semesters
  credits:           number | null
  control_form:      string | null    // форма контроля: экзамен / зачёт / …
  competency_codes:  string[]         // program competency codes this discipline develops
  sort_order:        number
}

export interface Program {
  id:                 string
  institution_id:     string
  created_by:         string | null
  name:               string
  code:               string | null
  level:              ProgramLevel | null
  duration_semesters: number
  description:        string | null
  // Official образовательная-программа header fields (intake form)
  specialty_name:     string | null   // Наименование профессии/специальности/направления/группы научных специальностей
  education_level:    string | null   // Уровень образования (free text)
  profile:            string | null   // Образовательная программа/направленность/профиль, шифр и наименование научной специальности
  forms_of_study:     string | null   // Реализуемые формы обучения
  // §7 org-tree link — the `program` org_unit whose head is this programme's
  // РОП. NULL for legacy programs; the IT admin sets the link on the edit
  // form. RОП scoping requires this to be set.
  org_unit_id:        string | null
  has_description_doc: boolean         // описание ОП PDF was imported
  has_plan_doc:        boolean         // учебный план PDF was imported
  // Per-semester ЗЕТ totals as printed in the plan's own «Итого/Всего»
  // rows (migration 057). Optional — legacy programmes / imports without an
  // Итого section have none. Used by deriveLoadCheck to reconcile the sum of
  // extracted disciplines against what the plan itself asserts, catching
  // truncated / mis-parsed extractions.
  reported_semester_totals?: Record<number, number>
  created_at:         string
  updated_at:         string
}

// Migration 050 attachments — рабочая программа + практики.
export type ProgramDocumentKind = 'working_programme' | 'practice'

export type ProgramPracticeType =
  | 'production_technological'      // Производственная (технологическая /
                                    //   проектно-технологическая) практика
  | 'production_pre_diploma'        // Производственная (преддипломная) практика
  | 'educational_familiarization'   // Учебная (ознакомительная) практика
  | 'educational_operational'       // Учебная (эксплуатационная) практика

export const PROGRAM_PRACTICE_TYPES: ProgramPracticeType[] = [
  'production_technological',
  'production_pre_diploma',
  'educational_familiarization',
  'educational_operational',
]

export const PROGRAM_PRACTICE_LABEL: Record<ProgramPracticeType, string> = {
  production_technological:    'Производственная (технологическая) практика',
  production_pre_diploma:      'Производственная (преддипломная) практика',
  educational_familiarization: 'Учебная (ознакомительная) практика',
  educational_operational:     'Учебная (эксплуатационная) практика',
}

// National-standard closed sets — used as dropdowns in the programme import
// form (and when an admin records ФГОС header data on a program org_unit).
// These are not per-institution, so they never need admin pre-entry — they're
// just enums that had no business being free text.
export const EDUCATION_LEVELS: string[] = [
  'Высшее образование — бакалавриат',
  'Высшее образование — специалитет',
  'Высшее образование — магистратура',
  'Высшее образование — подготовка кадров высшей квалификации (аспирантура)',
  'Среднее профессиональное образование',
]

// Реализуемые формы обучения — a programme may offer several; the value stored
// is these labels joined with ', ' (matches the free-text column shape).
export const STUDY_FORMS: string[] = ['очная', 'очно-заочная', 'заочная']

export interface ProgramDocument {
  id:            string
  program_id:    string
  kind:          ProgramDocumentKind
  practice_type: ProgramPracticeType | null
  // Migration 051 — which discipline this рабочая программа belongs to.
  // Only set when kind === 'working_programme'; null for 'practice'.
  discipline_id: string | null
  file_name:     string
  file_size:     number
  mime_type:     string
  uploaded_at:   string
}

// Migration 051 — result of checking an uploaded РПД against the
// competencies its discipline (or, for practices, the whole programme)
// claims to develop. Produced by services/documentReview.ts. Reuses
// CoverageStatus (defined above for grading bullet coverage) — same
// covered/partial/missing vocabulary, different subject.

// One индикатор достижения компетенции (e.g. ОПК-14.1) — the granularity a
// competency is actually assessed at (ФГОС 3++). A competency's coverage is
// the roll-up of its indicators. `dimension` is the Знать/Уметь/Владеть layer
// an indicator lives in, when the РПД makes it explicit.
export type IndicatorDimension = 'knowledge' | 'skill' | 'mastery'   // Знать / Уметь / Владеть

export interface DisciplineCoverageIndicator {
  code:      string | null       // '14.1' / 'ОПК-14.1'; null if the РПД gave no code
  title:     string
  dimension: IndicatorDimension | null
  status:    CoverageStatus
  evidence:  string | null       // verbatim quote from the content, or null
  note:      string
}

export interface DisciplineCoverageItem {
  code:     string | null   // 'УК-1' / 'ОПК-2' / 'ПК-3'; null for goals
  title:    string
  status:   CoverageStatus  // roll-up of `indicators` when present, else the model's own verdict
  evidence: string | null   // verbatim quote from the document, or null
  note:     string
  // Indicators the РПД declares for this competency, each scored against the
  // discipline content. Empty/absent on legacy reviews and on goals (which
  // have no indicators) — the UI falls back to the competency-level verdict.
  indicators?: DisciplineCoverageIndicator[]
}

export interface DisciplineCoverageResult {
  overall_coverage: number   // 0-100
  items:            DisciplineCoverageItem[]
  summary:          string
}

// One row per review run; the frontend reads the latest per discipline.
export interface ProgramDocumentReview {
  id:            string
  program_id:    string
  discipline_id: string | null
  document_id:   string
  result:        DisciplineCoverageResult
  created_at:    string
}

export interface ProgramDetail extends Program {
  disciplines:  ProgramDiscipline[]
  competencies: ProgramCompetency[]
  // Migration 050 — рабочая программа + практики as first-class attachments.
  // Description / plan continue to live inline on the Program row (as
  // extracted text) for now; this list surfaces the newer document set.
  documents?:   ProgramDocument[]
  // Populated when the program is linked into the tree (org_unit_id set).
  // Root-first, excludes the program unit itself. Used for the non-clickable
  // breadcrumb on the detail page so an РОП sees which институт contains
  // their programme.
  org_unit_ancestors?: { id: string; name: string; short_name: string | null; type_code: string }[]
  // Server-computed edit gate for THIS caller on THIS program. Frontend uses
  // it to render read-only mode cleanly (hide/disable Save, Analyze, Delete,
  // Edit affordances) instead of showing enabled buttons that 403.
  can_edit?: boolean
}

// ── Analysis result shapes ──

// One inferred prerequisite edge between two disciplines. `inverted` = the
// dependent discipline is taught no later than its prerequisite (a sequencing bug).
export interface PrerequisiteEdge {
  from_name:      string    // prerequisite (foundation)
  from_semester:  number
  to_name:        string    // dependent discipline
  to_semester:    number
  reason:         string    // why `to` depends on `from`
  inverted:       boolean
  recommendation: string    // RU fix (e.g. «перенести … на 3 семестр»)
}

// Holistic, whole-plan view derived from the prerequisite edges (no extra LLM
// cost). Turns the flat pairwise list into the year-1→final structure.
export interface SequencingLayerNode {
  name:     string
  semester: number
}
export interface SequencingLayer {
  depth:       number                // 0 = foundational entry points (no prerequisites)
  disciplines: SequencingLayerNode[] // disciplines at this dependency depth
}
export interface SequencingChain {
  names:  string[]   // ordered prerequisite → … → final discipline
  length: number     // = names.length
}
export interface SequencingStructure {
  layers:        SequencingLayer[]      // dependency depth across the whole plan
  longest_chains: SequencingChain[]     // the critical prerequisite spines (top few)
  isolated:      SequencingLayerNode[]  // disciplines outside the dependency graph (often general-ed)
}

export interface SequencingResult {
  verdict:        string             // 2–3 sentence overall flow assessment
  flow_score:     number             // 0–100 logical-sequencing score
  edges:          PrerequisiteEdge[] // all detected prerequisite links
  inversions:     PrerequisiteEdge[] // subset where inverted === true (convenience)
  // Whole-plan structure derived from `edges`. Optional — legacy cached
  // analyses (run before this shipped) won't have it; the UI guards for it.
  structure?:     SequencingStructure
}

export type CoverageLevel = 'introduce' | 'develop' | 'master'

export interface CompetencyTimelineCell {
  semester: number
  level:    CoverageLevel
  via:      string         // discipline delivering it at this point
}

export interface CompetencyProgressionRow {
  kind:        CompetencyKind
  code:        string | null
  title:       string
  cells:       CompetencyTimelineCell[]   // chronological coverage points
  status:      'ok' | 'late' | 'thin' | 'uncovered'  // never-covered / once-only / too-late / fine
  note:        string                     // RU explanation + recommendation
}

export interface RedundancyItem {
  name:           string    // discipline name (orphan) or competency code/title (missing)
  reason:         string
  recommendation: string
}

export interface RelatednessCluster {
  label:       string       // short RU theme label
  disciplines: string[]     // discipline names in the cluster
}

export interface SemesterLoad {
  semester:         number
  discipline_count: number
  credits:          number | null   // null when no credits entered
}

// Outcome-delivery synthesis — the headline answer to "does the whole plan
// deliver the graduate profile?". A pure roll-up of the competency progression
// statuses (no extra LLM call).
export interface OutcomeDelivery {
  total:      number   // requirements assessed (competencies + goals)
  fully:      number   // status 'ok' — built introduce→develop→master
  thin:       number   // 'thin' — built in only one discipline
  late:       number   // 'late' — introduced too late
  uncovered:  number   // 'uncovered' — no discipline forms it
  score:      number   // 0–100 delivery score
  verdict:    'delivered' | 'partial' | 'gaps'
  headline:   string   // 1–2 RU sentences
}

// How trustworthy the competency→discipline mapping is. The progression/gaps
// analysis maps competencies to disciplines from each discipline's declared
// `competency_codes` (authoritative) and, when those are empty, from the
// discipline NAME (inferred). When many disciplines carry no codes, an
// «uncovered» verdict may be a missing-data artefact, not a real gap — this
// tells the UI to say so.
export interface MappingConfidence {
  disciplines_total:      number
  disciplines_with_codes: number
  low:                    boolean   // < half of disciplines declare codes → treat gaps cautiously
}

// Trust signal for the relatedness/clustering pass. Clustering compares each
// discipline's EMBEDDED content — the uploaded РПД text when present, else the
// bare discipline name (short, generic, e.g. "Физика"). With few РПД uploaded,
// most disciplines embed on name alone, which routinely either (a) collapses
// into one giant "everything is similar" blob that the clustering algorithm
// deliberately suppresses as uninformative, or (b) sits in a similarity band
// that's neither a real cluster nor a real outlier. Either way the section
// reads as "Явных кластеров не выявлено" — true of the OUTPUT, misleading
// about the CAUSE (looks like "no thematic structure" when it's really "not
// enough real content to compare yet"). This tells the UI to say so.
export interface ContentConfidence {
  disciplines_total:        number
  disciplines_with_content: number   // had an uploaded РПД (or linked course syllabus) to embed on
  low:                      boolean  // < half of disciplines have real content → treat "no clusters" cautiously
}

// Sanity check on the credit load — the chart just sums whatever was extracted
// from the учебный план PDF, so a bad parse shows wrong numbers with no signal.
// ФГОС ВО: one academic year = 60 з.е. This flags the parse artefacts (missing
// tail, null ЗЕТ, semesters dumped together) so they aren't taken as real.
export interface LoadCheck {
  total_credits:               number
  expected_total:              number   // 60 × academic years
  disciplines_without_credits: number
  issues:                      string[] // RU one-liners; empty when the load looks sound
}

export interface ProgramAnalysis {
  generated_at:  string
  overall_score: number              // 0–100 headline score
  summary:       string              // 2–3 sentence verdict for the report header
  sequencing:    SequencingResult
  progression:   CompetencyProgressionRow[]
  orphans:       RedundancyItem[]    // disciplines serving no competency — remove candidates
  missing:       RedundancyItem[]    // competencies with no delivering discipline — add candidates
  clusters:      RelatednessCluster[]
  isolated:      string[]            // discipline names weakly related to everything else
  load:          SemesterLoad[]
  // Whole-plan outcome-delivery synthesis. Optional — legacy cached analyses
  // (run before this shipped) won't have it; the UI guards for it.
  outcome_delivery?: OutcomeDelivery
  // Trust signal for the competency→discipline mapping. Optional (legacy).
  mapping_confidence?: MappingConfidence
  // Trust signal for the relatedness/clustering pass. Optional (legacy).
  content_confidence?: ContentConfidence
  // Sanity check on the credit load vs the ФГОС 60-з.е./year rule. Optional.
  load_check?: LoadCheck
  // Non-fatal issues from the analysis run — an LLM pass that timed out, an
  // embed batch that failed. Empty when the run was clean. The UI surfaces
  // these so a section that came back empty is understood as a transient
  // failure, not a real "no data".
  warnings?: string[]
}

// ─── API error shape ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}
