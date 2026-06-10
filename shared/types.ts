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
  features: {
    documentUpload:      boolean
    ragFlywheel:         boolean
    emailGeneration:     boolean
    presentationHistory: boolean
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

// ─── Rubric ───────────────────────────────────────────────────────────────────

export interface RubricCriterion {
  name: string
  weight: number
  description: string
  max_score: number
}

export interface Rubric {
  id: string
  teacher_id: string
  course_id: string | null
  name: string
  criteria: RubricCriterion[]
  is_default: boolean
  created_at: string
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
  rubric_id: string | null
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
  created_at: string
}

// ─── API error shape ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}
