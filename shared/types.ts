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
  ai_strengths: string[] | null
  ai_improvements: string[] | null
  ai_revision_check: RevisionCheckItem[] | null   // present only on revisions
  criteria_snapshot: CriteriaSnapshotItem[] | null   // the criteria + weights used for this grading
  ai_confidence:     ConfidenceLevel | null       // present only on "thorough" (ensemble) gradings
  ai_ensemble:       AiEnsemble | null            // the variant samples behind the confidence
  approved_score: number | null
  approved_grade: GradeLetter | null
  approved_feedback: string | null
  approved_strengths: string[] | null     // teacher-edited bullet list (null = AI default)
  approved_improvements: string[] | null  // ditto — feeds the revision check on resubmission
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

export interface ChapterReview {
  title: string
  assessment: string      // 1–2 paragraphs on this section
  strengths: string[]
  gaps: string[]
}

export interface LongReviewResult {
  overall_summary:   string
  suggested_score:   number | null
  suggested_grade:   GradeLetter | null
  grade_label:       string | null
  chapter_reviews:   ChapterReview[]
  overall_strengths: string[]
  overall_gaps:      string[]
  defense_questions: string[]   // questions a committee might ask at the defence
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

// ─── API error shape ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}
