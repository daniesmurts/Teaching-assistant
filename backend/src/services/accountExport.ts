import { pool } from '../db/connection'
import { findTeacherRowById } from '../db/queries/teachers'
import { NotFoundError } from '../errors/AppError'

// What goes in the export. Sensitive payloads (submissions, syllabuses) are
// opt-in via flags; everything else is the teacher's own work and ships by
// default. Student names in grade exemplars are anonymised regardless.

export interface ExportOptions {
  include_submissions: boolean
  include_syllabuses:  boolean
}

export interface AccountExport {
  version:       1
  exported_at:   string
  teacher: {
    name:        string | null
    email:       string
    university:  string | null
    plan_tier:   string
    created_at:  string
  }
  courses:      Array<{ name: string; code: string | null; level: string | null; syllabus?: string | null }>
  criteria:     Array<{ name: string; description: string | null; subject: string | null; created_at: string }>
  rubrics:      Array<{ name: string; description: string | null; subject: string | null; items: Array<{ criterion_name: string; weight: number }>; created_at: string }>
  approved_grades: Array<{
    course:               string | null
    student_label:        string                  // anonymised: "Студент 1", "Студент 2", ...
    approved_score:       number | null
    approved_grade:       string | null
    approved_feedback:    string | null
    approved_strengths:   unknown[] | null
    approved_improvements: unknown[] | null
    criteria_snapshot:    unknown
    submission_text?:     string                  // present only when include_submissions
    approved_at:          string | null
  }>
  generated_summary: {
    presentations: number
    topics:        number
    quizzes:       number
  }
}

export async function buildAccountExport(
  teacherId: string,
  options: ExportOptions,
): Promise<AccountExport> {
  const teacher = await findTeacherRowById(teacherId)
  if (!teacher) throw new NotFoundError('Аккаунт')

  const [courses, criteria, rubrics, grades, summary] = await Promise.all([
    fetchCourses(teacherId, options.include_syllabuses),
    fetchCriteria(teacherId),
    fetchRubrics(teacherId),
    fetchApprovedGrades(teacherId, options.include_submissions),
    fetchGeneratedSummary(teacherId),
  ])

  return {
    version:     1,
    exported_at: new Date().toISOString(),
    teacher: {
      name:       teacher.name,
      email:      teacher.email,
      university: teacher.university,
      plan_tier:  teacher.plan_tier,
      created_at: teacher.created_at.toISOString(),
    },
    courses,
    criteria,
    rubrics,
    approved_grades:   grades,
    generated_summary: summary,
  }
}

async function fetchCourses(
  teacherId: string,
  includeSyllabuses: boolean,
): Promise<AccountExport['courses']> {
  const cols = includeSyllabuses ? 'name, code, level, syllabus_text' : 'name, code, level'
  const { rows } = await pool.query<{ name: string; code: string | null; level: string | null; syllabus_text?: string | null }>(
    `SELECT ${cols} FROM courses WHERE teacher_id = $1 ORDER BY created_at ASC`,
    [teacherId]
  )
  return rows.map((r) => {
    const c: AccountExport['courses'][number] = { name: r.name, code: r.code, level: r.level }
    if (includeSyllabuses) c.syllabus = r.syllabus_text ?? null
    return c
  })
}

async function fetchCriteria(teacherId: string): Promise<AccountExport['criteria']> {
  const { rows } = await pool.query<{
    name: string; description: string | null; subject: string | null; created_at: Date
  }>(
    `SELECT name, description, subject, created_at
       FROM criteria
      WHERE teacher_id = $1
        AND is_global_template = FALSE
      ORDER BY created_at ASC`,
    [teacherId]
  )
  return rows.map((r) => ({
    name:        r.name,
    description: r.description,
    subject:     r.subject,
    created_at:  r.created_at.toISOString(),
  }))
}

async function fetchRubrics(teacherId: string): Promise<AccountExport['rubrics']> {
  // Resolve criterion ids in the rubric items to criterion names so the export
  // remains useful even if the IDs are stripped (they're useless outside our DB).
  const { rows } = await pool.query<{
    name: string; description: string | null; subject: string | null
    items: Array<{ criterion_id: string; weight: number }>
    created_at: Date
  }>(
    `SELECT name, description, subject, items, created_at
       FROM rubrics
      WHERE teacher_id = $1
        AND is_global_template = FALSE
      ORDER BY created_at ASC`,
    [teacherId]
  )

  // Look up referenced criterion names in one query
  const allIds = Array.from(new Set(rows.flatMap((r) => (r.items ?? []).map((it) => it.criterion_id))))
  const nameById = new Map<string, string>()
  if (allIds.length > 0) {
    const { rows: critRows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM criteria WHERE id = ANY($1::uuid[])`,
      [allIds]
    )
    for (const c of critRows) nameById.set(c.id, c.name)
  }

  return rows.map((r) => ({
    name:        r.name,
    description: r.description,
    subject:     r.subject,
    items:       (r.items ?? []).map((it) => ({
      criterion_name: nameById.get(it.criterion_id) ?? '[удалённый критерий]',
      weight:         it.weight,
    })),
    created_at:  r.created_at.toISOString(),
  }))
}

async function fetchApprovedGrades(
  teacherId: string,
  includeSubmissions: boolean,
): Promise<AccountExport['approved_grades']> {
  const cols = [
    'a.approved_score', 'a.approved_grade', 'a.approved_feedback',
    'a.approved_strengths', 'a.approved_improvements', 'a.criteria_snapshot',
    'a.approved_at', 'a.student_name',
    'c.name AS course_name',
  ]
  if (includeSubmissions) cols.push('a.submission_text')

  const { rows } = await pool.query<{
    approved_score:        number | null
    approved_grade:        string | null
    approved_feedback:     string | null
    approved_strengths:    unknown[] | null
    approved_improvements: unknown[] | null
    criteria_snapshot:     unknown
    approved_at:           Date | null
    student_name:          string | null
    course_name:           string | null
    submission_text?:      string
  }>(
    `SELECT ${cols.join(', ')}
       FROM assignments a
       LEFT JOIN courses c ON c.id = a.course_id
      WHERE a.teacher_id = $1
        AND a.status = 'approved'
      ORDER BY a.approved_at ASC`,
    [teacherId]
  )

  // Anonymise: every distinct student_name (incl. null) gets a sequential label.
  const labelByName = new Map<string, string>()
  let counter = 0
  const labelFor = (name: string | null) => {
    const key = name ?? '__anonymous__'
    let label = labelByName.get(key)
    if (!label) {
      counter += 1
      label = `Студент ${counter}`
      labelByName.set(key, label)
    }
    return label
  }

  return rows.map((r) => {
    const row: AccountExport['approved_grades'][number] = {
      course:                r.course_name,
      student_label:         labelFor(r.student_name),
      approved_score:        r.approved_score,
      approved_grade:        r.approved_grade,
      approved_feedback:     r.approved_feedback,
      approved_strengths:    r.approved_strengths,
      approved_improvements: r.approved_improvements,
      criteria_snapshot:     r.criteria_snapshot,
      approved_at:           r.approved_at?.toISOString() ?? null,
    }
    if (includeSubmissions && r.submission_text != null) {
      row.submission_text = r.submission_text
    }
    return row
  })
}

async function fetchGeneratedSummary(teacherId: string): Promise<AccountExport['generated_summary']> {
  const { rows } = await pool.query<{
    presentations: string; topics: string; quizzes: string
  }>(
    `SELECT
       (SELECT COUNT(*) FROM presentations WHERE teacher_id = $1) AS presentations,
       (SELECT COUNT(*) FROM topic_sets    WHERE teacher_id = $1) AS topics,
       (SELECT COUNT(*) FROM quizzes       WHERE teacher_id = $1) AS quizzes`,
    [teacherId]
  )
  const r = rows[0]
  return {
    presentations: Number(r.presentations),
    topics:        Number(r.topics),
    quizzes:       Number(r.quizzes),
  }
}
