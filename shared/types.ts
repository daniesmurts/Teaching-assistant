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

// The same keys as runtime data, for the server's telemetry allowlist.
//
// This exists because the allowlist used to be a hand-written string list in
// backend/src/validation/publishedAssignmentValidation.ts, and it silently
// omitted `paste_count` — which the client has always sent, because it is on
// the interface above. Every draft save and every submit from a student
// answered 400 «Недопустимые поля телеметрии»: the whole writing surface was
// down, and nothing failed loudly enough to notice.
//
// `Record<keyof SubmissionTelemetry, true>` is what prevents a repeat: adding
// a field to the interface without adding it here is a compile error (missing
// property), and a key here that isn't on the interface is a compile error too
// (excess property). The list can no longer drift from the type it describes.
const TELEMETRY_KEY_MAP: Record<keyof SubmissionTelemetry, true> = {
  total_chars: true, active_ms: true, revision_count: true, paste_count: true,
  pasted_chars: true, largest_paste: true, started_at: true, last_edit_at: true,
}

export const SUBMISSION_TELEMETRY_KEYS = Object.keys(TELEMETRY_KEY_MAP) as Array<keyof SubmissionTelemetry>

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
    rpdMonitor:             boolean
    pptxExport:             boolean
    presentationDeepMode:   boolean
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
  // Research.md §7.10 Phase 1 — the 'curriculum' functional-authority domain
  // level, independent of is_institution_admin (e.g. a УМЦ head can hold this
  // without being a root admin). Computed from getAccessScope.
  curriculum_access?:    'none' | 'view' | 'edit' | 'admin'
  // Research.md §7.10 Phase 2 — the 'teaching' functional-authority domain
  // level (usage analytics, grading activity, leadership dashboards, roster
  // read), independent of is_institution_admin (e.g. a ПР УР can hold wide
  // read-only teaching access without being a root admin).
  teaching_access?:      'none' | 'view' | 'edit' | 'admin'
  // Research.md §7.10 Phase 3 slice B — the 'platform' functional-authority
  // domain level (org tree CRUD, role grants — NOT invites/deactivation/
  // settings, which stay root-admin-only): an institute director can hold
  // admin access scoped to their own subtree without being a root admin.
  platform_access?:      'none' | 'view' | 'edit' | 'admin'
  // docs/ACCESS-MATRIX.md — the 'umu' domain (Учебно-методическое управление):
  // РПД monitoring and future УМУ/УМЦ office tooling. Split out of
  // `curriculum` so a Заведующий кафедрой can hold curriculum:edit (to author
  // criteria) without seeing institution-wide filing compliance.
  umu_access?:           'none' | 'view' | 'edit' | 'admin'
  // docs/ACCESS-MATRIX.md — «Критерии/Рубрики» institution-curation access.
  // NOT the same as curriculum_access: that domain is shared by every
  // content-facing role (incl. РОП/РПГ/УМУ/РУМЦ/МУМЦ), but institution-shared
  // criteria curation is meant for department/institute leadership only
  // (ЗК/ДИ/ДЕК) plus a read-only view for top institutional leadership
  // (РЕК/ПР/ОА). Computed from getAccessScope filtered to the unit TYPE a
  // curriculum grant sits on — a plain `curriculum` level check can't tell a
  // РОП's grant on their `program` unit apart from a ЗК's on `department`.
  criteria_access?:      'none' | 'view' | 'edit' | 'admin'
  // docs/ACCESS-MATRIX.md — «Организация» overview surfaces (Обзор/
  // Использование/Преподаватели-чтение). Same shape as criteria_access and
  // the same reason: `teaching_access` alone is shared by every unit-scoped
  // role (incl. РОП on `program`, РПГ on `cluster`), but institution
  // oversight is department/institute leadership territory — a programme or
  // polygroup head's own subtree activity belongs on /leadership instead,
  // an unrelated gate this doesn't touch.
  org_overview_access?:  'none' | 'view' | 'edit' | 'admin'
  // docs/ACCESS-MATRIX.md — «Кабинет методиста» (TODO Feature AM). Not the
  // same as umu_access: that domain also gates Мониторинг РПД/Готовность
  // УМК (docs/ACCESS-MATRIX.md §4: strictly УМУ + РУМЦ), while Кабинет
  // методиста runs off curriculum-domain program access and is meant for
  // every УМУ-family role including Методист УМЦ (МУМЦ), who holds
  // curriculum:edit but no umu grant at all. Computed from getAccessScope
  // filtered to the unit TYPE a curriculum grant sits on (admin_office —
  // the type shared by УМУ/РУМЦ/МУМЦ, excluding ЗК/РОП/РПГ/ДИ/ДЕК who also
  // hold curriculum grants on other unit types).
  methodist_access?:    'none' | 'view' | 'edit' | 'admin'
  institution_id?: string | null
  // Mirror of the teacher's institution's shared_rag_enabled flag — surfaced
  // here so the Courses page can decide whether to show / enable the "поделиться
  // с кафедрой" toggle without an extra round-trip.
  institution_shared_rag_enabled?: boolean
  created_at:  string
}

export interface AuthResponse {
  draftKeySeed: string
  teacher:      Teacher
  plan:         PlanState
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

/**
 * What each level looks like for one criterion, keyed by the Russian 5-point
 * grade letter. Every key optional — a teacher may anchor only the extremes.
 *
 * Injected into the grading prompt so the model reasons against explicit level
 * anchors instead of inferring them from the criterion's name. Keyed by letter
 * rather than a score range because the bands are already canonical
 * (shared/grades.ts GRADE_BRACKETS) and teachers think «на пятёрку», not
 * «[87,100]».
 */
export type CriterionLevelDescriptors = Partial<Record<GradeLetter, string>>

export interface Criterion {
  id:                    string
  teacher_id:            string | null   // NULL for global templates
  course_id:             string | null
  name:                  string
  description:           string | null
  level_descriptors:     CriterionLevelDescriptors | null
  subject:               CriterionSubject | null
  is_global_template:    boolean
  is_institution_shared: boolean
  shared_unit_id:        string | null   // org unit (department/faculty/institution root) this is shared with
  created_at:            string
}

// Item shape inside assignments.criteria_snapshot. Weights/scores are filled in
// at grading time; criterion_id is null for the holistic mode.
export interface CriteriaSnapshotItem {
  criterion_id: string | null
  name:         string
  weight:       number          // 0–100, sum across items must be 100
  description:  string | null
  // Snapshotted alongside the description so a past grading stays
  // reproducible even after the teacher edits the criterion's anchors.
  level_descriptors?: CriterionLevelDescriptors | null
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
  shared_unit_id:        string | null   // org unit (department/faculty/institution root) this is shared with
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
  // Set only when confidence was 'low' and a reconciliation pass ran to
  // adjudicate a final score from the disagreement (see confidence.ts's
  // reconcileDisagreement). Absent means no reconciliation was attempted —
  // confidence wasn't low, or the pass failed and silently kept the primary.
  reconciled?:          boolean
  reconciliation_note?: string | null
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
  brs_checkpoint_id: string | null   // Feature AE — БРС контрольная точка this score counts toward, if any
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

// Async presentation generation jobs (presentation_jobs table) — same
// enqueue-and-poll shape as grade jobs; see presentation_jobs migration.
//
// 'outline_ready' is the optional approval gate (TODO.md "### AO" Phase 0):
// the job pauses after the cheap outline pass and waits for the teacher to
// confirm (or edit) the plan before the expensive expansion runs. A job
// started with review_outline=false never enters it.
export type PresentationJobStatus = 'pending' | 'processing' | 'outline_ready' | 'ready' | 'failed'

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
  course_name:   string | null
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

// Feature AN (TODO.md "### AN") — the scope ladder a document's RAG
// visibility can be promoted along, and the provenance attestation required
// above 'course'. 'platform' is a real stored value (curated ИСПУМ content)
// but is never reachable through the promotion endpoint — see
// routes/documents.ts.
export type DocumentVisibilityScope = 'course' | 'unit' | 'institution' | 'platform'
export type DocumentProvenance = 'own_work' | 'open_licence' | 'institution_owned' | 'unknown'

// One row in "Библиотека кафедры" (GET /api/institution/library).
export interface LibraryDocumentEntry {
  id:               string
  file_name:        string
  teacher_id:       string
  teacher_name:     string | null
  course_id:        string | null
  course_name:      string | null
  document_type:    'assignment' | 'syllabus' | 'material'
  visibility_scope: DocumentVisibilityScope
  scope_unit_id:    string | null
  provenance:       DocumentProvenance
  created_at:       string
  reuse_count:       number
}

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
  // Feature AN Phase 0 — where the source document was pooled from, so the
  // popover can attribute a pooled hit (e.g. «Материалы кафедры») instead of
  // implying it was the teacher's own upload. Optional/undefined for any
  // source produced before this field existed (older stored citations).
  source_scope?: 'course' | 'unit' | 'institution' | 'platform'
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

// Тематический план of a course (migration 121, TODO.md "### AO" Phase 3) —
// the lecture list extracted from the programme, which a teacher picks from
// instead of retyping a topic and its number for every deck.
export interface LectureTopic {
  id:          string
  course_id:   string
  position:    number            // 1-based; doubles as the suggested lecture number
  title:       string
  description: string | null     // the РПД's own wording for what the тема covers
  source:      'syllabus' | 'manual'
  created_at:  string
}

// One slide's worth of plan, produced by the outline pass and consumed by
// the expansion pass (services/presentations.ts). Lives here rather than in
// the service because the outline approval gate (TODO.md "### AO" Phase 0)
// puts it on the wire: the teacher edits this shape before expansion runs.
//
// `brief` is a technical brief for the expansion pass, not prose — "виды
// насосов: объёмные vs динамические, критерий выбора", not "рассказать про
// насосы".
export interface PresentationOutlineSlide {
  type:  SlideType
  title: string
  brief: string
}

// Controls how much material generation asks the model for per slide —
// notes word-count target and RAG source count. 'deep' is Pro+ gated
// (`presentationDeepMode` in planLimits.ts); 'standard' is the baseline for
// every tier and already a large step up from the pre-outline+expansion
// single-call generation (see TODO.md Feature AG).
export type PresentationDepth = 'standard' | 'deep'

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
  // Optional supplementary visual (TODO.md Feature AG Phase 2) — any slide
  // type can carry one, not just DiagramSlide. `image_query` null/absent
  // means "no image wanted"; auto-filled at generation when present (see
  // presentations.ts's autoFillImages), swappable via the same picker
  // DiagramSlide already uses. DiagramSlide deliberately keeps its OWN
  // `body.image_query`/`body.image` instead of these — moving them here
  // would silently orphan the image on every already-persisted diagram
  // slide (stored as JSONB with the old shape), so it stays the anchor case
  // and these top-level fields are simply unused for `type: 'diagram'`.
  image_query?: string | null
  image?:       SlideImage | null
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
  // Denormalised alongside course_id for display (history list subject tag) —
  // null whenever course_id is null, or on rows returned by a write path
  // that doesn't join courses (create/update — the list is what re-fetches
  // with the join, so freshly-created rows don't need it populated).
  course_name: string | null
  lecture_number: number | null
  // Which тема of the course's тематический план this lecture covers, when it
  // was started from the plan (migration 121). Nulled — not deleted — if the
  // plan is later re-extracted, so a deck outlives the plan it came from.
  lecture_topic_id: string | null
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

// ─── Slide-count sizing ──────────────────────────────────────────────────────
//
// Shared rather than duplicated per side: the form's max, the server's
// validation cap and the generator's own clamp all have to agree, or a
// teacher gets silently fewer slides than they asked for (which is exactly
// what happened while the ceiling lived in three places).

// Minutes of lecture per slide. Was effectively 2.0 (an inline `/ 2` in
// services/presentations.ts), which teachers reported as far too sparse —
// their own figure is 1–1.5 min/slide, i.e. a 45-minute lecture wants 30–45
// slides, not 23. Set to the conservative end of that range; this is THE
// knob to tune as feedback arrives.
export const MINUTES_PER_SLIDE = 1.5

// Ceiling on both the automatic estimate and the manual target. Raised from
// 50 in step with MINUTES_PER_SLIDE so a 90-minute lecture (→ 60) is
// actually reachable. Not a token wall — outlineMaxTokens() covers ~82
// slides — but past that the single outline call is the real constraint.
export const MAX_SLIDE_COUNT = 60
export const MIN_SLIDE_COUNT = 5

export function estimateSlideCount(minutes: number): number {
  return Math.max(MIN_SLIDE_COUNT, Math.min(MAX_SLIDE_COUNT, Math.round(minutes / MINUTES_PER_SLIDE)))
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
  course_name:    string | null
  // The lecture deck this test was generated from, when it came from
  // «Проверить усвоение» (TODO.md "### AO" Phase 3) rather than the Тесты
  // form. Nulled — not deleted — if that deck is later removed (migration 120).
  presentation_id: string | null
  topic:          string
  level:          QuizLevel | null
  question_count: number
  questions:      QuizQuestion[]
  sources:        PresentationSource[] | null
  created_at:     string
}

// ─── Live QR quiz (TODO.md Feature Y) ──────────────────────────────────────────
// A teacher runs an existing quiz live in the lecture hall — students join
// anonymously via a short join code (QR or typed), answer one question at a
// time, teacher's projector screen shows a live histogram. v1 slice of the
// §3.1 live-lecture engagement layer (Research.md) — no WebRTC/ASR/heatmap.

export type LiveSessionStatus = 'lobby' | 'question' | 'reveal' | 'finished'

// 'paced' — the original teacher-driven mode: the whole room is locked to
// whatever question the teacher is currently showing.
// 'self_paced' — each participant moves through the quiz at their own
// speed; live_sessions.status/current_question_index only track a coarse
// session-level open/closed marker (lobby -> question -> finished), the
// real per-student progress lives on live_participants.
export type LiveSessionMode = 'paced' | 'self_paced'

export interface LiveQuestionResult {
  question_index: number
  answer_counts:  number[]   // length 4, indexed by option
  correct_index:  number
}

export interface LiveSessionParticipantProgress {
  id:                      string
  nickname:                string | null
  current_question_index: number
  finished_at:             string | null
  score:                   { correct: number; total: number }   // "who got what points" — computed against the quiz's own correct_index, present regardless of mode or whether they've finished yet
  already_saved:           boolean   // true once this participant's result has been saved to the grading journal (assignments table) — idempotency signal for the save-to-journal review screen
}

export interface LiveSession {
  id:                      string
  teacher_id:              string
  quiz_id:                 string
  join_code:               string
  mode:                    LiveSessionMode
  status:                  LiveSessionStatus
  current_question_index: number
  participant_count:       number
  answer_counts:           number[] | null   // live counts for the CURRENT question; null in lobby/finished — 'paced' only
  results:                 LiveQuestionResult[] | null   // 'paced' only
  participants:            LiveSessionParticipantProgress[] | null   // host roster / leaderboard view — both modes
  created_at:              string
  finished_at:             string | null
}

export interface LiveJoinState {
  mode:                    LiveSessionMode
  status:                  LiveSessionStatus
  current_question_index: number
  question:                { question: string; options: string[]; explanation?: string } | null
  has_answered:            boolean
  my_choice:               number | null   // this participant's own pick for the current question, if answered
  correct_index:           number | null   // only populated once status === 'reveal'
  participant_score:       { correct: number; total: number } | null   // only populated once status === 'finished'
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
  // Раздел 13 «Образовательные технологии» — declared teaching methods
  // (кейс-метод, проблемное обучение, …). Scored ONLY against СРС
  // (independent) + control/ФОС content, never lectures/practicals/labs —
  // per the УМЦ's ask: does what's declared here actually show up in how
  // independent work and assessment are run.
  | 'technology'

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
  technologies_count: number
  content_sections:   ContentSection[]   // which content sections were located
}

// ─── «Знать/Уметь/Владеть» formulation quality ────────────────────────────────
// Raised by a методист reviewing a real РПД (2026-08-20): the coverage check
// scored ЗУВ items at 100% «Обеспечена» when they were the competency
// indicators copy-pasted verbatim. Her rule: a ЗУВ formulation must convey
// the indicator's MEANING through this discipline's own content — being
// identical to it is a defect, not a pass. Produced deterministically by
// services/outcomeFormulation.ts (no LLM — "is this a copy" is a measurable
// string question), and kept as its own findings list rather than folded
// into the coverage status, since "is it delivered?" and "is it copy-pasted?"
// are independent questions.

export type OutcomeKind = 'knowledge' | 'skill' | 'mastery'

export type OutcomeFormulationFindingKind = 'copied_from_indicator'

export interface OutcomeFormulationFinding {
  kind:            OutcomeFormulationFindingKind
  outcome_kind:    OutcomeKind
  outcome_title:   string        // the «должен знать/уметь/владеть» text as written
  indicator_code:  string | null // e.g. 'ОПК-4.1'; null when the РПД gave no code
  indicator_title: string        // the indicator it duplicates
  similarity:      number        // 0–1 token containment
  detail:          string
  recommendation:  string
}

// The second half of the same методист's rule, raised 2026-08-24 after the
// copy check above was fixed: «нужна еще проверка смысла, формулировки — то
// есть того, как формулировка "должен знать" отражает индикатор и есть ли
// смысловая связь с дисциплиной». Copy-detection only answers "is this a
// literal duplicate"; a ЗУВ reworded just enough to clear that threshold can
// still be generic boilerplate that names no content this discipline
// actually teaches. That is a judgement, not a string measurement, so unlike
// OutcomeFormulationFinding this one IS produced by an LLM pass
// (services/outcomeMeaning.ts). Findings are problems only — an item the
// model rates 'ok' produces nothing.
//   'not_reflected' — the ЗУВ does not convey the indicator's meaning at all
//   'weak_link'     — it conveys it, but generically: nothing ties it to this
//                     discipline's own content
export type OutcomeMeaningVerdict = 'not_reflected' | 'weak_link'

export interface OutcomeMeaningFinding {
  verdict:         OutcomeMeaningVerdict
  outcome_kind:    OutcomeKind
  outcome_title:   string
  indicator_code:  string | null   // which declared requirement it should reflect
  indicator_title: string | null   // null when the model could match none
  detail:          string
  recommendation:  string
}

// ─── «Связка оценочного средства» — п.4 ↔ СРС ↔ КСР ↔ п.9 ↔ ФОС ──────────────
// Raised by a методист (2026-08-20): an оценочное средство named in §4's
// «Оценочные средства» column is a promise the rest of the РПД has to keep —
// the student needs time to prepare it (СРС), the teacher needs to be
// scheduled to assess it (КСР), and it has to carry points in the БРС (§9).
// A name that appears in §4 and nowhere else is an assessment that exists
// only on paper. Produced by services/assessmentLinkage.ts: LLM extraction
// (reading the table out of prose), deterministic linkage (whether «Доклад»
// is present in «Подготовка доклада» is a measurable string question).
//
// ФОС is deliberately NOT verified — it's a separate document governed by the
// institution's own положение and isn't in the РПД text, so each finding
// carries an explicit "check the ФОС yourself" reminder instead.

export type LinkageSlot = 'srs' | 'ksr' | 'brs' | 'fos'

export interface ParsedAssessmentLinkage {
  instruments: { name: string; section: string | null }[]   // §4, last column
  srs_forms:   string[]                                     // СРС forms
  ksr_forms:   string[]                                     // КСР forms
  // §9 БРС checkpoints. Carries min AND max because the ФОС макет requires
  // both («Min, баллов (базовый уровень)» / «Max, баллов (повышенный
  // уровень)») and sources them from §9 — until 2026-08-25 only the max was
  // kept, which made that comparison impossible. `semester` matters: a
  // multi-semester discipline repeats the same instrument with DIFFERENT
  // points per semester (observed: «Проект» 10/15, 10/15, 18/30), and the
  // 60/100 total is per semester, not per discipline.
  brs_items:   BrsScoreRow[]
}

export interface BrsScoreRow {
  name:        string
  semester:    string | null   // e.g. '1-й семестр'; null when §9 isn't split
  min_points:  number | null
  max_points:  number | null
}

// ─── ФОС «Перечень оценочных средств» ↔ §9 ───────────────────────────────────
// Requested by a методист 2026-08-25: «программа видит похоже только наличие…
// Хотелось бы, чтобы программа анализировала также правильность оформления в
// ФОСе по макету… баллы должны брать из п.9 РП». The КНИТУ «Макет ФОС 3++»
// states the rule itself, directly under the table:
//   «Примечание: перечень оценочных средств приводиться из п.9 рабочей
//    программы по дисциплине (модулю)»
// so this is arithmetic, not judgement: same instruments, same min, same max,
// and each semester totalling 60/100 (confirmed as a hard КНИТУ invariant).

export interface FosScoreRow {
  name:        string
  semester:    string | null
  count:       number | null   // «Кол-во»
  min_points:  number | null
  max_points:  number | null
}

export type FosScoreFindingKind =
  | 'missing_in_fos'     // §9 declares it; the ФОС table doesn't list it
  | 'missing_in_rpd'     // the ФОС table lists it; §9 doesn't
  | 'min_mismatch'
  | 'max_mismatch'
  | 'total_mismatch'     // a semester's Итого isn't 60/100
  // The third arithmetic layer the макет implies: §9 → перечень ФОС →
  // «Критерии оценки». The макет's лабораторная criteria table sums to 12/20,
  // exactly its row in the перечень.
  | 'criteria_sum_mismatch'    // the block's own components don't add up to what it declares
  | 'criteria_table_mismatch'  // the block's declared total ≠ its перечень row

// One instrument's «Критерии оценки» block. The макет writes these two ways —
// as a table (Виды работ | Минимальный балл | Максимальный балл | ИТОГО) and
// as prose («максимальная оценка за работу составляет 20 баллов… Из них:
// Презентация работы – мах 3 балла; …») — so extraction is a model's job;
// only the arithmetic below is done in code.
export interface FosCriteriaBlock {
  instrument:     string
  declared_min:   number | null   // the block's own stated total, when it states one
  declared_max:   number | null
  component_min:  number | null   // sum of the itemised parts; null when none were itemised
  component_max:  number | null
}

export interface FosScoreFinding {
  kind:        FosScoreFindingKind
  instrument:  string | null   // null for a whole-semester total finding
  semester:    string | null
  rpd_min:     number | null
  rpd_max:     number | null
  fos_min:     number | null
  fos_max:     number | null
  detail:          string
  recommendation:  string
}

// ─── ФОС ↔ «Макет ФОС 3++»: структурное соответствие ─────────────────────────
// Second half of the same 2026-08-25 request: «Хотелось бы, чтобы программа
// анализировала также правильность оформления в ФОСе по макету». The макет
// prescribes a fixed skeleton, so "does this document have the blocks the
// макет requires" is a string question, not a judgement — deterministic, like
// the copy check and unlike the meaning check.

export type FosSectionKey =
  | 'title_page'            // «ФОНД ОЦЕНОЧНЫХ СРЕДСТВ» титульный лист
  | 'compiler'              // «Составитель ФОС»
  | 'competency_map'        // перечень компетенций и индикаторов + этапы формирования
  | 'score_table'           // перечень оценочных средств (Кол-во / Min / Max)
  | 'grading_scale'         // шкала оценивания (5/4/3/2 × баллы × критерии)
  | 'instrument_catalogue'  // краткая характеристика оценочных средств

export type FosStructureFindingKind = 'missing_section' | 'missing_criteria'

export interface FosStructureFinding {
  kind:        FosStructureFindingKind
  section:     FosSectionKey | null   // set for 'missing_section'
  instrument:  string | null          // set for 'missing_criteria'
  detail:          string
  recommendation:  string
}

export interface FosStructureCheck {
  checked:   boolean            // false when no ФОС was attached at all
  present:   FosSectionKey[]    // sections the document does have
  findings:  FosStructureFinding[]
  summary:   string
}

// ─── §9 БРС readiness — «можно ли из этого п.9 собрать корректный ФОС» ───────
// The other end of the chain the методист described: a ФОС's перечень is its
// discipline's §9, so a §9 that is incomplete or doesn't total 60/100 cannot
// produce a conformant ФОС no matter how the ФОС is written. Checked at
// authoring time so the teacher sees it before a ФОС is ever generated,
// rather than a методист finding it months later.

export type BrsReadinessFindingKind =
  | 'no_scores'          // §9 has no rows at all
  | 'missing_points'     // a row without a minimum or a maximum
  | 'min_above_max'      // minimum higher than maximum
  | 'semester_total'     // a semester doesn't add up to 60/100
  | 'unknown_instrument' // not in the макет's catalogue — the ФОС can't describe it

export interface BrsReadinessFinding {
  kind:            BrsReadinessFindingKind
  severity:        ReviewSeverity
  instrument:      string | null
  semester:        string | null
  detail:          string
  recommendation:  string
}

export interface BrsReadinessCheck {
  checked:   boolean            // false when §9 wasn't present to check
  ready:     boolean            // no 'error'-severity findings
  findings:  BrsReadinessFinding[]
  summary:   string
}

export interface FosScoreCheck {
  // False when no ФОС was attached, or its «Перечень оценочных средств» table
  // could not be found — distinct from "found it and everything matched", the
  // same distinction fos_available draws for the presence check.
  table_found: boolean
  rows:        FosScoreRow[]
  criteria:    FosCriteriaBlock[]
  findings:    FosScoreFinding[]
  summary:     string
}

export interface AssessmentLinkageFinding {
  instrument:          string
  section:             string | null   // раздел дисциплины it was declared under
  missing:             LinkageSlot[]   // 'fos' only ever appears here when fos_available is true
  brs_missing_points:  boolean         // named in §9 but with no max balls
  matched_srs:         string | null   // the phrase that satisfied the link, when it did
  matched_ksr:         string | null
  matched_brs:         string | null
  matched_fos:         string | null   // non-null when the instrument was found in an uploaded ФОС
  detail:              string
  recommendation:      string
}

export interface AssessmentLinkageResult {
  // Numeric ФОС↔§9 reconciliation. Present only when a ФОС was uploaded AND
  // its score table parsed; absent otherwise.
  fos_scores?:   FosScoreCheck
  // Structural conformance of the ФОС to КНИТУ's «Макет ФОС 3++».
  fos_structure?: FosStructureCheck
  // Whether §9 itself is in a state a conformant ФОС could be built from —
  // independent of whether a ФОС exists yet, so it is always present.
  brs_readiness?: BrsReadinessCheck
  parsed:        ParsedAssessmentLinkage
  // Whether an institution-filed ФОС document was attached to this
  // discipline (via program_documents' 'fos' kind) and actually checked.
  // False means every finding's ФОС link is genuinely unverified, not
  // "checked and failed" — the report must not conflate the two.
  fos_available: boolean
  findings:      AssessmentLinkageFinding[]
  summary:       string
  generated_at:  string
}

export interface SyllabusReview {
  competencies_source: 'declared' | 'provided'   // extracted from the РПД vs. supplied
  goals_source:        'declared' | 'provided'
  parsed?:      ParsedSyllabusReport             // structural parse summary
  items:        SyllabusCoverageItem[]
  // Optional — absent on reviews produced before this check shipped, and
  // empty on the РПД-студия path (caller-supplied competencies carry no
  // indicators to compare against). The UI guards for both.
  formulation_findings?: OutcomeFormulationFinding[]
  // Meaning/quality of those same ЗУВ formulations (services/outcomeMeaning.ts).
  // Optional and best-effort: an empty array means "checked, nothing wrong",
  // while a non-empty `warnings` means the pass did not complete — the two
  // must never be conflated, which is exactly the failure mode that made the
  // copy check look healthy while it silently did nothing.
  meaning_findings?:     OutcomeMeaningFinding[]
  // How many scored items are themselves verbatim copies of a requirement
  // already counted. They inflate covered/partial/missing below, so the
  // report states the number rather than quietly redefining those three.
  duplicate_count?:      number
  // Non-fatal problems during the review (an optional LLM pass that failed).
  // Same convention as ProgramAnalysis.warnings.
  warnings?:             string[]
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
  id:          string
  teacher_id:  string
  course_id:   string | null
  course_name: string | null
  kind:        MaterialKind
  topic:       string
  difficulty:  TaskDifficulty
  tasks:       TaskItem[]
  created_at:  string
}

// ─── ФОС generator (TODO.md Feature X) ─────────────────────────────────────────
// Assembles a discipline's фонд оценочных средств from existing generators
// (quizzes, tasks) plus one new generator (экзаменационные билеты) and a
// deterministic coverage self-check. v1 is teacher-scoped: topics/competencies
// come from courses.syllabus_text (ad hoc extraction), not the programme/
// org-tree competency model — see Research.md §9.2 and TODO.md Feature X for
// the v2 programme-integrated follow-up.

export type FosStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface FosTicket {
  number:            number
  theory_questions:  string[]   // exactly 2
  practical_task:    string
  topics:            string[]   // topic tags this ticket draws on — feeds the coverage check
}

export interface FosPassportRow {
  competency:  string | null   // free-text in v1 — no controlled vocabulary without a programme link
  topic:       string
  instruments: string[]        // e.g. "Тест", "Практическое задание", "Билет №3"
}

export interface FosCriterionScale {
  grade:       GradeLetter
  description: string
}

export interface FosCriterion {
  title: string
  scale: FosCriterionScale[]
}

// ─── ФОС по «Макету ФОС 3++» ─────────────────────────────────────────────────
// The generator emits the макет's own skeleton, so a generated ФОС satisfies
// services/fosStructure.ts by construction rather than being checked against
// it afterwards. Every field below is optional on FosSections: documents
// generated before this shipped simply don't have them, and the export guards
// for each.

export interface FosTitlePage {
  discipline:     string
  direction:      string | null   // код и наименование направления подготовки
  profile:        string | null
  qualification:  string | null
  faculty:        string | null
  department:     string | null
  year:           number
}

export interface FosCompetencyMapRow {
  indicator:    string
  lectures:     string   // темы, на которых индикатор формируется
  practicals:   string
  labs:         string
  coursework:   string
  instruments:  string
}

export interface FosGradingScaleRow {
  digit:            string   // '5'
  points:           string   // '87 - 100'
  word:             string   // 'Отлично (зачтено)'
  criteria_exam:    string
  criteria_credit:  string
}

export interface FosCatalogueRow {
  name:            string
  description:     string
  representation:  string   // «Представление оценочного средства в фонде»
}

export interface FosCriteriaComponent {
  label:  string
  min:    number | null
  max:    number | null
}

// Points come from §9 РПД and are distributed across the components in code,
// so the sums the conformance check verifies are exact by construction — the
// model only supplies the wording of each component.
export interface FosInstrumentCriteria {
  instrument:    string
  components:    FosCriteriaComponent[]
  declared_min:  number | null
  declared_max:  number | null
}

export interface FosSections {
  passport: {
    competencies: string[]
    topics:       string[]
    rows:         FosPassportRow[]
  }
  quiz_ids:  string[]   // existing `quizzes` rows generated for this ФОС (reused as-is)
  task_sets: { id: string; kind: MaterialKind }[]   // existing `task_sets` rows — kind kept alongside id so the UI can link to the right generator page (/materials/:kind)
  tickets:      FosTicket[]
  criteria:     FosCriterion[]
  // Макет blocks. Optional for back-compat with ФОС generated before this.
  title_page?:           FosTitlePage
  competency_map?:       FosCompetencyMapRow[]
  score_table?:          FosScoreRow[]        // sourced from §9 РПД
  grading_scale?:        FosGradingScaleRow[]
  catalogue?:            FosCatalogueRow[]
  instrument_criteria?:  FosInstrumentCriteria[]
}

export interface FosCoverageReport {
  topics_covered:          string[]
  topics_uncovered:        string[]   // topics with zero instruments across quiz/tasks/tickets
  competencies_uncovered:  string[]
  balance_warning:         string | null   // e.g. "тема «X» встречается в 6 из 8 билетов"
}

export interface FosDocument {
  id:             string
  course_id:      string
  teacher_id:     string
  status:         FosStatus
  progress_done:  number
  progress_total: number
  sections:       FosSections | null
  coverage:       FosCoverageReport | null
  error_message:  string | null
  created_at:     string
  updated_at:     string
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

// A ПК indicator (ПК-1.1/.2/.3) — unlike УК/ОПК indicators (which come
// verbatim from the ФГОС), ПК indicators are institution-authored, so they
// exist only as data the ОП itself owns, not as a reference-registry row.
export interface ProgramCompetencyIndicator {
  id?:         string
  code:        string
  title:       string
  sort_order:  number
}

export interface ProgramCompetency {
  id?:         string
  kind:        CompetencyKind
  code:        string | null      // 'УК-1' / 'ОПК-2' / 'ПК-3'; null for goals
  title:       string
  sort_order:  number
  // Traceability for ПК only (migration 115, методист feedback item 3) —
  // which ОТФ (обобщённая трудовая функция) inside which профстандарт this
  // ПК was derived from. УК/ОПК use fgos_competency_id (migration 099)
  // instead; the two links are deliberately separate columns/fields since
  // the invariant they support is opposite (УК/ОПК SHOULD be verbatim
  // federal text; ПК must NOT be verbatim ОТФ text).
  profstandard_otf_id?:  string | null
  indicators?:           ProgramCompetencyIndicator[]
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
  // «Ответственный за дисциплину» (migration 097, docs/RPD-WORKFLOW.md) — who
  // must author and submit this discipline's РПД. READ-ONLY on this shape:
  // assigned through its own endpoint, deliberately NOT part of the plan
  // structure that replaceDisciplines rewrites, so re-saving the учебный план
  // never clears it. `_name` is denormalised for display only.
  responsible_teacher_id?:   string | null
  responsible_teacher_name?: string | null
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
// 'fos' (methodist feedback, 2026-08-20) — a discipline's real, institution-
// filed ФОС (фонд оценочных средств), attached the same way as a working
// programme (one CURRENT file per discipline, supersede-on-reupload). Lets
// «Связка оценочного средства» (services/assessmentLinkage.ts) actually
// verify the ФОС link instead of only reminding the reader to check it by
// hand. Deliberately NOT the same thing as fos_documents (Feature X's
// «Собрать ФОС» generator) — that's an AI DRAFT tied to a teacher's personal
// course, this is the institution's own filed document tied to a programme
// discipline.
export type ProgramDocumentKind = 'working_programme' | 'practice' | 'fos'

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
  // Migration 084 — set when a later upload superseded this one (only ever
  // non-null for kind === 'working_programme'; practices still hard-replace).
  // The Documents tab's "current" file per discipline is the one row per
  // discipline_id with superseded_at === null.
  superseded_at: string | null
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

// Migration 084 — «Что изменилось с прошлого года» (Research.md §9.6):
// compares a discipline's current РПД against the version it superseded.
// Produced by services/programDiff.ts.

export type DiffChangeKind = 'added' | 'removed' | 'changed'

export interface DocumentDiffTopicChange {
  kind:     DiffChangeKind
  topic:    string   // new wording if added/changed, old wording if removed
  detail:   string   // 1 sentence on what changed; '' for a pure add/remove
  // Verbatim quote validated against the NEW text (added/changed) or the OLD
  // text (removed) — same evidence contract as DisciplineCoverageItem.
  evidence: string | null
}

export interface DocumentDiffCompetencyChange {
  kind:  DiffChangeKind
  code:  string | null   // 'УК-1' / 'ОПК-2' / 'ПК-3'
  title: string
  detail: string
}

export interface DocumentDiffAssessmentChange {
  kind:   DiffChangeKind
  form:   string   // e.g. 'экзамен', 'курсовая работа'
  detail: string
}

export interface DocumentDiffResult {
  summary:      string
  // True when the model found no material differences between the two
  // versions — paraphrase/formatting-only changes don't count as findings.
  unchanged:    boolean
  topics:       DocumentDiffTopicChange[]
  competencies: DocumentDiffCompetencyChange[]
  assessment:   DocumentDiffAssessmentChange[]
}

// One row per (old_document_id, new_document_id) pair — cached so reopening
// the diff panel doesn't re-run the LLM comparison.
export interface ProgramDocumentDiff {
  id:              string
  program_id:      string
  discipline_id:   string
  old_document_id: string
  new_document_id: string
  result:          DocumentDiffResult
  created_at:      string
}

// ─── РПД approval workflow (docs/RPD-WORKFLOW.md, phase 4b) ────────────────
// State machine over a discipline's РПД submission. Five states, not six:
// `returned` is one state, and WHICH stage returned it is a separate field
// (derivable from which status the return happened from, but stored
// explicitly — submitted->returned is always 'rop', forwarded->returned is
// always 'umc').

export type RpdSubmissionStatus = 'draft' | 'submitted' | 'returned' | 'forwarded' | 'approved'
export type RpdSubmissionStage  = 'rop' | 'umc'
export type RpdSubmissionAction = 'submit' | 'return' | 'forward' | 'approve'

export interface RpdSubmissionEvent {
  id:          string
  from_status: RpdSubmissionStatus | null
  to_status:   RpdSubmissionStatus
  actor_id:    string | null
  actor_name:  string | null
  comment:     string | null
  created_at:  string
}

export interface RpdSubmission {
  id:                string
  program_id:        string
  discipline_id:     string
  document_id:       string | null
  status:            RpdSubmissionStatus
  returned_by_stage: RpdSubmissionStage | null
  submitted_by:      string | null
  submitted_at:      string | null
  updated_at:        string
  // Denormalised for list/queue views — avoids an extra join per consumer.
  discipline_name?:   string
  program_name?:      string
  program_code?:      string | null
  responsible_teacher_name?: string | null
  coverage?:          number | null   // latest program_document_reviews.overall_coverage, if any
}

// ─── УМЦ dashboard (TODO Feature V) ────────────────────────────────────────
// Institution-wide readiness matrix — one row per (programme, discipline),
// assembled entirely from existing signals (program_documents,
// program_document_reviews): does a working РПД exist, has it been checked
// against its claimed competencies, when. No new analysis engine — this is
// aggregation over what curriculumAnalysis/documentReview already compute.

export interface UmcReadinessRow {
  program_id:              string
  program_name:            string
  program_code:            string | null
  department_org_unit_id:  string | null
  department_name:         string | null   // 'Без подразделения' when the programme has no org-tree link
  discipline_id:           string
  discipline_name:         string
  semester:                number
  has_syllabus:            boolean
  syllabus_uploaded_at:    string | null
  reviewed:                boolean
  overall_coverage:        number | null   // 0-100, from the latest program_document_reviews row
  review_created_at:       string | null
  // Phase 4c (docs/RPD-WORKFLOW.md) — the approval-stage this discipline's
  // РПД is at, distinct from has_syllabus/reviewed (which only say whether a
  // file exists and whether the AI checked it, not where it sits in the
  // human approval route). NULL = never submitted through the workflow.
  submission_status:       RpdSubmissionStatus | null
}

export interface UmcDepartmentSummary {
  department_org_unit_id: string | null
  department_name:        string
  discipline_count:       number
  syllabus_count:         number
  reviewed_count:         number
  avg_coverage:           number | null   // average overall_coverage among REVIEWED disciplines only
}

export interface UmcDashboardTotals {
  discipline_count: number
  syllabus_count:   number
  reviewed_count:   number
  avg_coverage:     number | null
}

export interface UmcDashboardResult {
  rows:        UmcReadinessRow[]
  departments: UmcDepartmentSummary[]
  totals:      UmcDashboardTotals
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
  from_id?:       string    // program_disciplines.id — set when from_name resolved to a real discipline
  to_name:        string    // dependent discipline
  to_semester:    number
  to_id?:         string    // program_disciplines.id — set when to_name resolved to a real discipline
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
  // Discipline names the LLM returned as an edge endpoint that didn't match
  // any discipline in the plan (topology substrate, docs/topology-spec.md
  // §3.1) — previously silently dropped. Optional — legacy cached analyses
  // won't have it.
  unmatched_names?: string[]
}

export type CoverageLevel = 'introduce' | 'develop' | 'master'

export interface CompetencyTimelineCell {
  semester: number
  level:    CoverageLevel
  via:      string         // discipline delivering it at this point
  via_discipline_id?: string  // program_disciplines.id — set when `via` resolved to a real discipline
}

export interface CompetencyProgressionRow {
  kind:        CompetencyKind
  code:        string | null
  title:       string
  competency_id?: string                  // program_competencies.id — the source row's id, always known (not LLM-derived)
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
  // ПК formulation copy-check (methodist feedback item 3, migration 115).
  // Optional (legacy caches predate it, and it's empty when no ПК in the
  // programme has an ОТФ linked yet).
  pk_formulation_findings?: PkFormulationFinding[]
}

// ─── Topology graph substrate (docs/topology-spec.md, Increment 0+) ────────────
//
// Read-side shapes for the persisted prerequisite/competency-link edges
// (migration 099) — the id-based rows programAnalysis.ts's LLM passes now
// write to, instead of only a discard-after-render report. Write-side DB
// params (Replace*Input) stay local to backend/src/db/queries/programTopology.ts
// — not part of this cross-boundary contract.

// 'declared' (migration 100) — a §2 «Место дисциплины в структуре ОП»
// statement in the discipline's own РПД. Higher-precision than 'extracted'
// (whole-plan LLM inference, capped 8-20 edges): follows the 'manual'/
// 'confirmed' preservation rule, i.e. re-running the plan-wide sequencing
// analysis never touches it — only re-running THIS discipline's placement
// review replaces its own 'declared' edges.
export type PrerequisiteOrigin = 'extracted' | 'manual' | 'confirmed' | 'declared'
export type CompetencyLinkStage = 'introduce' | 'develop' | 'master'

export interface ProgramPrerequisite {
  id:                          string
  program_id:                  string
  discipline_id:               string
  prerequisite_discipline_id:  string
  reason:                      string
  inverted:                    boolean
  origin:                      PrerequisiteOrigin
  analysis_id:                 string | null
  created_at:                  string
  updated_at:                  string
}

export interface ProgramCompetencyLink {
  id:               string
  program_id:       string
  discipline_id:    string
  content_unit_id:  string | null
  competency_id:    string
  stage:            CompetencyLinkStage
  origin:           PrerequisiteOrigin
  analysis_id:      string | null
  evidence_quote:   string | null
  created_at:       string
  updated_at:       string
}

export interface ProgramTopology {
  prerequisites:    ProgramPrerequisite[]
  competencyLinks:  ProgramCompetencyLink[]
}

export interface ProgramContentUnit {
  id:             string
  discipline_id:  string
  section:        ContentSection
  title:          string
  topics:         string[]
  source_doc_id:  string | null
  provenance:     'approved' | 'latest'
  sort_order:     number
  created_at:     string
}

// ─── «Место дисциплины в структуре ОП» — РПД §2 placement check ───────────────
// (migration 100). Parses §2 (predecessor/successor disciplines + declared
// направление/профиль) and checks it against three independent sources: the
// real plan (program_disciplines.semester), the programme's own направление/
// профиль, and — for asymmetry — other disciplines' own latest placement
// review. Produced by services/placementReview.ts.

// A name in §2 that doesn't resolve to a plan discipline is either a genuine
// error (typo, phantom discipline) or a legitimate external prerequisite
// (school course, another направление) — these need different treatment, so
// resolution is a first-class field rather than folding external names into
// "unmatched".
export type PlacementResolution = 'internal' | 'external' | 'unmatched'

export interface DeclaredPrerequisiteLink {
  raw_name:      string                    // verbatim name as written in §2
  role:          'predecessor' | 'successor'
  resolution:    PlacementResolution
  discipline_id: string | null             // set when resolution === 'internal'
  semester:      number | null             // the matched discipline's semester, for internal links
  // Verbatim quote from §2 naming this discipline, validated against the
  // document the same way as grading/documentReview citations (rule #2) —
  // null if the model's quote didn't survive validation. Lets the teacher
  // check the finding against the actual document text instead of trusting
  // the paraphrase.
  quote:         string | null
}

export type PlacementFindingKind =
  | 'phantom'        // D1 — declared name resolves to nothing in the plan and isn't plausibly external
  | 'inversion'      // D2 — declared predecessor taught later (or successor taught earlier) than this discipline
  | 'asymmetry'      // D3 — the counterpart discipline's own §2 doesn't declare the symmetric relationship
  | 'empty_section'  // D4 — §2 names no disciplines at all
  | 'wrong_program'  // D5 — §2's stated направление/профиль doesn't match this programme's
  | 'weak_rationale' // D6 — a declared prerequisite's content shows little affinity with this discipline's content
  | 'missing_link'   // D7 — an earlier-semester discipline with strong content affinity that §2 omits

export type PlacementSeverity = 'error' | 'warning' | 'suggestion'

export interface PlacementFinding {
  kind:            PlacementFindingKind
  severity:        PlacementSeverity
  discipline_name: string            // the other discipline involved (declared or suggested), '' for D4/D5
  detail:          string            // 1-2 sentences, human-readable
  evidence:        string | null     // verbatim quote grounding the finding (D6/D7), else null
  recommendation:  string
}

export interface PlacementReviewResult {
  declared:          DeclaredPrerequisiteLink[]
  declared_program:  string | null   // направление/профиль as stated in §2, if any
  findings:          PlacementFinding[]
  summary:           string
}

export interface ProgramPlacementReview {
  id:            string
  program_id:    string
  discipline_id: string
  document_id:   string
  result:        PlacementReviewResult
  created_at:    string
}

// Shared across every РПД-section check (§2 placement, §12 МТО, …) — same
// three-tier severity, just attached to different finding shapes.
export type ReviewSeverity = PlacementSeverity

// ─── «МТО» — РПД §12 «Материально-техническое обеспечение» check ──────────────
// (migration 101). Phase 1, no licensed-software registry (deferred — the
// actual licence list lives in the university's own procurement/IT system,
// not in ИСПУМ): catches the "мел, доска и парта" non-answer — §12 lists no
// named software at all — and cross-checks named tools mentioned in the
// discipline's own лабораторные/практические content against what §12
// declares, so a lab that clearly uses AutoCAD/MATLAB/1С/etc. but never
// lists it in §12 gets flagged with a citation from the content itself.
// Produced by services/mtoReview.ts.

export type MtoSoftwareCategory = 'general' | 'specialized'

export interface MtoDeclaredItem {
  raw_name: string
  quote:    string | null   // verbatim quote from §12 naming this item
  // Set on software_items only (undefined on generic_items — furniture has
  // no category axis). 'general' = office suite / archiver / browser / PDF
  // reader / antivirus / OS — recognisable regardless of discipline.
  // 'specialized' = discipline-relevant tooling (CAD, statistics, industry
  // software, …). A software list that's ALL 'general' is boilerplate, not
  // an actual answer to "what does THIS discipline need" — see
  // 'generic_software_only' below.
  category?: MtoSoftwareCategory
}

export type MtoFindingKind =
  | 'generic_only'            // §12 names zero software at all
  | 'generic_software_only'   // §12 names software, but it's ALL general-purpose — no specialized tool
  | 'undeclared_tool'         // a tool named in лаб/практ content isn't in §12
  // Cross-discipline suggestion (no LLM domain-knowledge guessing — grounded
  // in another discipline's OWN declared specialized software + document
  // quote, surfaced only when content affinity is high). Deliberately NOT
  // "the AI thinks this field usually needs X" — see the discussion this
  // check was designed from: an ungrounded guess would be the one finding in
  // this feature that isn't citation-backed, undermining trust in the rest.
  | 'missing_specialized_tool'

export interface MtoFinding {
  kind:           MtoFindingKind
  severity:       ReviewSeverity
  item_name:      string          // the tool/software name involved, '' for generic_only
  detail:         string
  evidence:       string | null   // verbatim quote — from §12 or from the lab/practical content
  recommendation: string
}

export interface MtoReviewResult {
  software_items: MtoDeclaredItem[]   // named software/hardware products §12 declares
  generic_items:  MtoDeclaredItem[]   // generic classroom items (мел, доска, парта, проектор, …)
  findings:       MtoFinding[]
  summary:        string
}

export interface ProgramMtoReview {
  id:            string
  program_id:    string
  discipline_id: string
  document_id:   string
  result:        MtoReviewResult
  created_at:    string
}

// ─── API error shape ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}

// ─── Feature AA v1 — ФГОС 3++ registry (TODO.md "### AA") ─────────────────────
// Platform-wide reference data (federal law, one per направление × level) —
// never institution-scoped. A standard stays 'draft' until a platform admin
// confirms the review screen; only 'published' rows are meant for downstream
// consumers (Feature Z's профстандарт selection, K's conformance check).

export interface FgosCompetency {
  id?:                   string
  type:                  'УК' | 'ОПК'
  code:                  string
  formulation:           string
  is_verbatim_verified:  boolean
}

export interface FgosStructureRequirement {
  id?:          string
  block_label:  string
  min_credits:  number | null
  max_credits:  number | null
  notes:        string | null
}

export interface FgosProfstandardRef {
  id?:              string
  code:             string
  name:             string
  source_url:       string | null
  // Migration 115 — links this bare reference to the real профстандарт
  // registry once an admin has matched/published one. Nullable: a ref
  // extracted from a ФГОС's appendix starts unlinked, same as before this
  // column existed.
  profstandard_id?: string | null
}

export interface FgosStandard {
  id:             string
  direction_code: string
  level:          string
  title:          string
  generation:     string | null
  order_number:   string | null
  order_date:     string | null
  source_url:     string | null
  effective_date: string | null
  status:         'draft' | 'published'
  created_at:     string
}

export interface FgosStandardWithChildren extends FgosStandard {
  competencies:             FgosCompetency[]
  structure_requirements:   FgosStructureRequirement[]
  profstandard_refs:        FgosProfstandardRef[]
}

export interface FgosDraft {
  standard: {
    direction_code: string | null
    level:          string | null
    title:          string | null
    generation:     string | null
    order_number:   string | null
    order_date:     string | null
    effective_date: string | null
  }
  competencies:            FgosCompetency[]
  structureRequirements:   FgosStructureRequirement[]
  profstandardRefs:        FgosProfstandardRef[]
}

// ─── Профстандарт/ОТФ registry (migration 115, методист feedback item 3) ──────
// Mirrors the ФГОС registry above exactly: federal reference data (a
// профстандарт is independent of any one ФГОС — many ФГОС can cite the same
// one), admin-curated, draft until the review screen is confirmed (rule #3).
// Consumed by the Конструктор's ПК↔ОТФ picker and services/pkFormulation.ts.

export interface ProfstandardOtf {
  id?:                     string
  otf_code:                string          // 'A' / 'B' / 'C' …
  name:                    string          // ОТФ formulation, verbatim from source
  qualification_level:     string | null   // уровень квалификации, e.g. '6'
  education_requirement:   string | null   // «Требования к образованию» cell
  is_verbatim_verified:    boolean
  sort_order:              number
}

export interface Profstandard {
  id:           string
  code:         string
  name:         string
  source_url:   string | null
  status:       'draft' | 'published'
  created_at:   string
}

export interface ProfstandardWithChildren extends Profstandard {
  otf: ProfstandardOtf[]
}

export interface ProfstandardDraft {
  standard: {
    code: string | null
    name: string | null
  }
  otf: ProfstandardOtf[]
}

// Options for the Конструктор's ПК↔ОТФ picker — one entry per профстандарт
// the programme's ФГОС cites, each ОТФ flagged with whether its «требования
// к образованию» matches the programme's own level (computed server-side
// via services/fgosMatch.ts's inferFgosLevel, not re-derived on the client).
export interface ProfstandardOtfOption extends ProfstandardOtf {
  level_match: boolean
}
export interface ProfstandardOption {
  id:   string
  code: string
  name: string
  otf:  ProfstandardOtfOption[]
}

// ─── ПК formulation copy-check (methodist feedback item 3) ────────────────────
// Same defect class as OutcomeFormulationFinding above, one level up: a ПК
// competency or indicator that merely restates its linked ОТФ's wording
// instead of conveying its meaning through the programme's own content.
// Deterministic — see services/pkFormulation.ts's header for why.

export interface PkFormulationFinding {
  competency_code:  string | null
  competency_title: string
  // Which part of the competency was flagged — the ПК title itself, or one
  // of its ПК-N.1 indicators.
  indicator_code:   string | null
  otf_code:         string
  otf_name:         string
  similarity:        number
  detail:            string
  recommendation:    string
}

// ─── Feature AE v1 — БРС engine (TODO.md "### AE") ────────────────────────────
// Per-course teacher data (unlike ФГОС's platform-wide reference data above).
// A scheme stays 'draft' until the teacher confirms the review screen; only
// 'published' rows feed the semester ledger. Re-extracting/editing an
// already-published scheme creates a new (course_id, version) row rather
// than mutating the old one, so historical accruals stay reproducible.

export interface BrsCheckpoint {
  id?:                   string
  name:                  string
  max_points:            number
  checkpoint_type:       'graded' | 'manual'
  is_verbatim_verified:  boolean
}

export interface BrsGradeThreshold {
  min_points:  number
  max_points:  number
  grade_label: string
}

export interface BrsDraft {
  id?:              string
  status?:          'draft' | 'published'
  version?:         number
  title:            string | null
  checkpoints:      BrsCheckpoint[]
  gradeThresholds:  BrsGradeThreshold[]
}

export interface BrsCheckpointAccrual {
  checkpoint_id:    string
  checkpoint_name:  string
  max_points:       number
  earned_points:    number | null
  raw_points:       number | null
}

export interface BrsStudentAccrual {
  student_name?:      string
  student_group?:     string | null
  checkpoints:        BrsCheckpointAccrual[]
  total_points:       number
  total_max_points:   number
  final_grade_label:  string | null
}

// РОП Студия v0 (TODO.md Feature Z, Phase 0) — labor-market evidence.

export interface SampleVacancy {
  title:    string
  employer: string
  salary:   string | null
  url:      string
  date:     string
}

export interface ProfessionSnapshot {
  term:   string
  total:  number
  sample: SampleVacancy[]
}

// Multi-region support (migration 090) — one generation can be grounded in
// vacancy data across several regions at once, not just the first picked.
export interface RegionSnapshot {
  region_code:   string
  region_name:   string
  by_profession: ProfessionSnapshot[]
}

export interface SupportedRegion {
  code: string
  name: string
}

export interface MarketEvidenceProfstandardRef {
  code: string
  name: string
}

// Plane-2 (Feature Z Phase 0 pilot completion) — a verbatim excerpt from the
// university's own «стратегия развития», cited alongside the Plane-1
// vacancy/профстандарт sources. Empty when no strategy document is uploaded
// or none matched closely enough (Plane-2 is optional per generation).
export interface MarketEvidenceStrategyExcerpt {
  text:       string
  page_start: number | null
  page_end:   number | null
}

export interface MarketEvidence {
  id:                string
  program_id:        string
  region_codes:      string[]
  region_names:      string[]
  professions:       string[]
  vacancy_snapshot:  RegionSnapshot[]
  profstandard_refs: MarketEvidenceProfstandardRef[]
  strategy_excerpts: MarketEvidenceStrategyExcerpt[]
  section_text:      string
  created_at:        string
  updated_at:        string
}

// ─── Activation funnel (admin dashboard) ─────────────────────────────────────

export interface FunnelSummary {
  total_teachers:         number
  created_course:         number
  reached_first_grade:    number
  created_presentation:   number
  graded_within_24h:      number
  graded_within_72h:      number
  graded_within_7d:       number
  median_hours_to_grade:  number | null
}

export interface FunnelCohort {
  week:                  string   // ISO date of the cohort week's Monday
  signups:               number
  created_course:        number
  reached_first_grade:   number
  median_hours_to_grade: number | null
}

export interface StalledTeacher {
  id:              string
  email:           string
  name:            string | null
  created_at:      string
  last_seen_at:    string | null
  first_course_at: string | null
  first_grade_at:  string | null
}

// ─── Grading — student summaries / trajectories ────────────────────────────────

export interface StudentSummary {
  student_name:    string
  student_group:   string | null
  submissions:     number
  avg_score:       number | null   // average of approved (fallback ai) score
  last_submission: string          // ISO
}

// ─── Audit log (admin) ───────────────────────────────────────────────────────

export interface AuditFilters {
  institutionId?: string   // optional — omit for all institutions
  actorTeacherId?: string
  action?: string          // exact match on the action string
  from?: string            // ISO date — inclusive lower bound on created_at
  to?: string              // ISO date — inclusive upper bound on created_at
  limit?: number
  offset?: number
}

// ─── Institution contracts (admin) ───────────────────────────────────────────

export interface InstitutionContract {
  id:                string
  institution_id:    string
  annual_value_rub:  number   // NUMERIC — parsed to a real number by connection.ts's global type parser (OID 1700), not left as a string
  seats_purchased:   number
  term_start:        string   // 'YYYY-MM-DD' — explicitly cast to text in every query below; a raw DATE column comes back
  term_end:          string   // as a JS Date at UTC midnight, one well-known step from a local-timezone display bug
  notes:             string | null
  created_by:        string | null
  created_at:        string
  updated_at:        string
}

// ─── Leadership dashboard ────────────────────────────────────────────────────

export interface LeadershipProgramUnitState {
  unit_id:              string
  unit_name:            string
  unit_short_name:      string | null
  program_id:           string | null
  program_name:         string | null
  program_code:         string | null
  program_level:        string | null
  has_description_doc:  boolean
  has_plan_doc:         boolean
  discipline_count:     number
  competency_count:     number
  last_analysis_at:     string | null
}

// ─── Payments (admin) ────────────────────────────────────────────────────────

export interface PaymentsSummary {
  revenue_this_month_kopecks: number
  revenue_30d_kopecks:        number
  confirmed_30d:              number
  rejected_30d:               number
  active_subscribers:         number   // auto-renew on, card on file, plan not expired
  in_grace:                   number   // renewal failed, still inside grace window
}

export interface MonthlyRevenue {
  month:              string   // 'YYYY-MM'
  revenue_kopecks:    number
  confirmed_count:    number
  rejected_count:     number
}

// ─── Policy memos (Кабинет методиста) ────────────────────────────────────────

export interface PolicyMemo {
  course_id:      string
  memo_text:      string
  based_on_count: number
  generated_at:   string
  model_used:     string | null
}

// ─── Program unit / teacher pickers ──────────────────────────────────────────

// Program units the caller may link a new/edited programme to. Server picks
// the right set per scope: all program units in the institution for all-rw;
// the caller's subtree-walked set for specific (РОПы, polygroup heads).
export interface PickableProgramUnit {
  id:         string
  name:       string
  short_name: string | null
  type_code:  'program' | 'program_direction'
  // Programme metadata (migration 055) — prefills the import form when the
  // admin recorded the ФГОС header on the unit.
  code:            string | null
  specialty_name:  string | null
  education_level: string | null
  forms_of_study:  string | null
}

export interface AssignableTeacher {
  id:    string
  name:  string | null
  email: string
}

// ─── Shared RAG summary ──────────────────────────────────────────────────────

export interface SharedRagSummary {
  enabled:               boolean
  shared_courses_n:      number
  participating_teachers_n: number
  cross_uses_30d:        number
  courses: Array<{
    course_id:        string
    course_name:      string
    course_code:      string | null
    teacher_id:       string
    teacher_name:     string | null
    approved_n:       number      // teacher's total approved grades on this course
    cross_uses_30d:   number      // times this course's grades fed someone else's RAG
  }>
}

// ─── Capacity model (admin dashboard) ────────────────────────────────────────

export interface TierDistributionRow {
  tier: string
  n:    number
  mean: number
  p50:  number
  p95:  number
  max:  number
}

export interface FreeOutlierRow {
  thresholdUsd: number
  count:        number
  total:        number
}

export interface InstitutionSummaryRow {
  institutionId:  string
  name:           string
  activeSeats:    number
  seatsPurchased: number | null
  utilizationPct: number | null
  costUsd:        number
  revenueUsd:     number | null
  marginUsd:      number | null
  costPerSeatUsd: number
}

export interface ResourceHeadroom {
  key:             string
  label:           string
  unit:            string
  current:         number
  ceiling:         number | null
  ceilingLabel:    string
  projectedAtScenario: number | null
  breaksAtTeachers:    number | null
  // TODO.md Feature AL Phase 3 — for resources actually bound by
  // concurrency (db_connections), the mean-based breaksAtTeachers above
  // understates real risk. This is that number corrected by the empirical
  // peak-to-mean ratio (services/providerCeilings.ts) — null for resources
  // where peak concurrency isn't the relevant failure mode (pgvector,
  // db_size are cumulative totals, not concurrency-bound).
  breaksAtTeachersPeakAdjusted?: number | null
  note?:           string
}

export interface HeadroomResult {
  activeTeachers:    number
  scenarioTeachers:  number
  resources:         ResourceHeadroom[]
}

export interface CapacityOverview {
  month:              string
  availableMonths:    string[]
  trackingSinceMonth: string | null
  isTrendReady:       boolean
  activeTeachers:     number
  tierDistribution:   TierDistributionRow[]
  freeOutliers:       FreeOutlierRow[]
  institutions:        InstitutionSummaryRow[]
  fixedCostUsd:        number | null
  variableCostPerTeacherUsd: number | null
  headroom:            HeadroomResult
  providerCeilings:    ProviderCeilingsReport   // TODO.md Feature AL Phase 3
}

// ─── Cohort analytics ────────────────────────────────────────────────────────

export interface GroupBreakdown {
  group:     string | null
  count:     number
  avg_score: number | null
  histogram: Record<string, number>
}

export interface MissedCriterion {
  name:      string
  avg_score: number
  count:     number
}

export interface SlippingStudent {
  student_name:  string
  student_group: string | null
  recent_avg:    number
  prior_avg:     number
  delta:         number   // recent - prior, always negative for a "slipping" entry
}

export interface CohortAnalytics {
  total_students:      number
  total_submissions:   number
  histogram:            Record<string, number>
  by_group:             GroupBreakdown[]
  top_missed_criteria:  MissedCriterion[]
  slipping:             SlippingStudent[]
}

// ─── Document chat ───────────────────────────────────────────────────────────

export interface ChatTurn {
  role:    'user' | 'assistant'
  content: string
}

export interface DocChatSource {
  idx:         number
  document_id: string
  file_name:   string
  page_start:  number | null
  page_end:    number | null
  excerpt:     string
}

export interface DocChatResult {
  answer:   string
  sources:  DocChatSource[]
  grounded: boolean   // false = the refusal path fired; answer is fixed text, not model output
}

// ─── Feedback library ────────────────────────────────────────────────────────

export interface FeedbackHit {
  assignment_id:        string
  course_name:          string | null
  student_label:        string | null     // group only — kept identifiable for the teacher's own context
  approved_score:       number | null
  approved_grade:       string | null
  approved_feedback:    string | null     // typically the most relevant body
  feedback_excerpt:     string            // first ~240 chars for list display
  similarity:           number            // pgvector cosine distance (lower = closer)
  approved_at:          string | null
}

// ─── Grading response (assignment grade) ─────────────────────────────────────

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
  ai_confidence: ConfidenceLevel | null
  ai_ensemble: AiEnsemble | null
  ai_calc_verification: CalcStepVerdict[]
  ai_citation_check: CitationVerdict[]
  used_examples: number
  revision_number: number
  parent_assignment_id: string | null
}

// ─── Learning loop metrics ───────────────────────────────────────────────────

export interface LearningLoopSummary {
  style_match: {
    current_pct:  number | null   // 0–100, null when not enough data
    previous_pct: number | null
    delta:        number | null   // current - previous, signed
    sample_n_30d: number
  }
  approved: {
    lifetime:   number
    this_month: number
    delta_vs_last_month: number
  }
  used_as_example_30d: number
  bullets_retention_30d: {
    pct:        number | null     // 0–100
    sample_n:   number
  }
  kafedra_contribution_30d: number   // 0 when teacher has no institution
  trend_weekly: Array<{ week: string; mean_delta: number; n: number }>
}

// ─── LTI roster ──────────────────────────────────────────────────────────────

export interface LtiRosterMember {
  userId: string
  name:   string | null
  email:  string | null
}

// ─── Provider ceilings (admin dashboard) ─────────────────────────────────────

export interface RateLimitKnee {
  observed:                          boolean   // did we ever actually hit a 429 in the window?
  minHourlyVolumeWithRateLimit:       number | null   // smallest hourly call volume where a 429 occurred
  maxHourlyVolumeWithoutRateLimit:    number | null   // largest hourly call volume that stayed clean
}

export interface AccountCeiling {
  account:           string
  burnRatePerDayUsd: number
  balanceFailures:   number
  failureCount:      number
  lastSuccessAt:      string | null
  lastFailureAt:      string | null
  // A recent failure with no success since is the closest historical proxy
  // for "currently unhealthy" this data supports — real cooldown state
  // (llm/deepseek.ts's downUntil map) is in-process and per-PM2-worker, not
  // centrally queryable, so this is evidence, not a live status.
  possiblyUnhealthy: boolean
}

export interface ProviderCeilingsReport {
  windowDays:       number
  peakToMean:       { ratio: number | null; totalCalls: number; peakHourlyCalls: number }
  rateLimitKnee:    RateLimitKnee
  accounts:         AccountCeiling[]
  // Static risk, not a metric — invariant #9 forces ALL embeddings through
  // Yandex and llm/yandex.ts has no multi-account pool (unlike DeepSeek,
  // which got one after a real 402 incident). Surfaced here rather than
  // buried in a comment because it's exactly the kind of "worth recording
  // as a risk with no mitigation" item this phase exists to make visible.
  yandexEmbedSpofNote: string
}

// ─── РПД monitor overview ────────────────────────────────────────────────────

export interface RpdParseFlag {
  deptCode: string
  eduForm:  string
  eduLevel: string
  message:  string
}

export interface RpdTotals {
  planCount: number
  rpdDone:   number
  rpdReview: number
  rpdDebt:   number
  rpdPct:    number
  fosDone:   number
  fosReview: number
  fosDebt:   number
  fosPct:    number
}

export interface RpdGroupOverview extends RpdTotals {
  groupId:   string
  groupName: string
  deptCount: number
  deltaRpdDone: number | null
  deltaRpdDebt: number | null // current - previous; negative means долг shrank (good)
}

export interface RpdProblemDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDebt:   number
  rpdPct:    number
  stalled:   boolean // no progress since the previous snapshot
}

export interface RpdLeaderDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDone:   number
  rpdDebt:   number
  rpdPct:    number
  improved:  boolean // rpd_done increased since the previous snapshot
}

export interface RpdRegressedDept {
  deptCode:     string
  eduForm:      string
  eduLevel:     string
  groupName:    string | null
  planCount:    number
  previousDebt: number
  currentDebt:  number
  deltaDebt:    number  // > 0 — долг got worse since the previous snapshot
  deltaReview:  number  // usually negative here — на проверке drained without becoming сделано
}

export interface RpdAllDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDone:   number
  rpdReview: number
  rpdDebt:   number
  rpdPct:    number
  fosDone:   number
  fosReview: number
  fosDebt:   number
  fosPct:    number
  deltaRpdDone: number | null
}

export interface RpdOverview {
  snapshot: { id: string; capturedAt: string; periodLabel: string | null; sourceFilename: string | null }
  previousSnapshot: { id: string; capturedAt: string } | null
  totals: RpdTotals
  previousTotals: RpdTotals | null
  groups: RpdGroupOverview[]
  ungroupedDeptCodes: string[]
  problemDepts: RpdProblemDept[]
  leaderDepts: RpdLeaderDept[]
  /** Кафедры whose долг got worse since the previous snapshot — usually because
      на проверке drained (rejected/returned) faster than it converted to сделано.
      Explains cases where both Сделано and Долг rise in the same period: they're
      not each other's mirror, на проверке is — this is that regression made visible. */
  regressedDepts: RpdRegressedDept[]
  /** Every кафедра/форма/уровень row in the snapshot — problemDepts/leaderDepts are curated
      top-N views of this same data, capped for the at-a-glance panels; this is the complete list
      so no department is ever invisible on the platform. */
  allDepts: RpdAllDept[]
  timeSeries: Array<{ snapshotId: string; capturedAt: string; planCount: number; rpdDone: number; rpdPct: number }>
}
