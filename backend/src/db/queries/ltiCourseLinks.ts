import { pool } from '../connection'
import { createCourse } from './courses'

export interface LtiCourseLinkRow {
  id:                            string
  institution_id:                string
  deployment_id:                 string
  context_id:                    string
  context_title:                 string | null
  context_label:                 string | null
  org_unit_id:                   string | null
  course_id:                     string | null
  nrps_context_memberships_url:  string | null
  first_seen_at:                 Date
  last_launch_at:                Date
}

export interface LtiCourseLinkWithNames extends LtiCourseLinkRow {
  course_name:   string | null
  org_unit_name: string | null
}

/** For the institution-admin course-mapping UI — every link for the
 *  institution, unmapped ones first, joined with display names. Purely
 *  informational: an unmapped row never blocks a teacher from grading. */
export async function listLtiCourseLinksForInstitution(institutionId: string): Promise<LtiCourseLinkWithNames[]> {
  const { rows } = await pool.query<LtiCourseLinkWithNames>(
    `SELECT l.*, c.name AS course_name, u.name AS org_unit_name
       FROM lti_course_links l
       LEFT JOIN courses c   ON c.id = l.course_id
       LEFT JOIN org_units u ON u.id = l.org_unit_id
      WHERE l.institution_id = $1
      ORDER BY (l.org_unit_id IS NULL) DESC, l.last_launch_at DESC`,
    [institutionId]
  )
  return rows
}

/** Scoped to the institution — a link belongs to it or the call is a no-op. */
export async function setLtiCourseLinkOrgUnit(
  id: string,
  institutionId: string,
  orgUnitId: string | null
): Promise<LtiCourseLinkRow | null> {
  const { rows } = await pool.query<LtiCourseLinkRow>(
    `UPDATE lti_course_links SET org_unit_id = $3
      WHERE id = $1 AND institution_id = $2
      RETURNING *`,
    [id, institutionId, orgUnitId]
  )
  return rows[0] ?? null
}

/** Looks up the course link that produced a given GradeAssist course, if any
 *  — used by the NRPS roster picker to find the membership URL to fetch. */
export async function findLtiCourseLinkByCourseId(courseId: string): Promise<LtiCourseLinkRow | null> {
  const { rows } = await pool.query<LtiCourseLinkRow>(
    `SELECT * FROM lti_course_links WHERE course_id = $1 LIMIT 1`,
    [courseId]
  )
  return rows[0] ?? null
}

/** Best-effort capture of the NRPS membership URL — same "opportunistic,
 *  never blocks the launch" contract as the AGS lineitem capture. */
export async function recordNrpsMembershipsUrl(
  institutionId: string,
  deploymentId: string,
  contextId: string,
  membershipsUrl: string
): Promise<void> {
  await pool.query(
    `UPDATE lti_course_links
        SET nrps_context_memberships_url = $4
      WHERE institution_id = $1 AND deployment_id = $2 AND context_id = $3`,
    [institutionId, deploymentId, contextId, membershipsUrl]
  )
}

/** Read-only lookup for launches that must not auto-create a course (student
 *  launches) — they only need the link id, which should already exist from
 *  the instructor's own earlier launch of the same context. */
export async function findLtiCourseLinkId(
  institutionId: string,
  deploymentId: string,
  contextId: string
): Promise<string | null> {
  const link = await findLtiCourseLink(institutionId, deploymentId, contextId)
  return link?.id ?? null
}

async function findLtiCourseLink(
  institutionId: string,
  deploymentId: string,
  contextId: string
): Promise<LtiCourseLinkRow | null> {
  const { rows } = await pool.query<LtiCourseLinkRow>(
    `SELECT * FROM lti_course_links
      WHERE institution_id = $1 AND deployment_id = $2 AND context_id = $3
      LIMIT 1`,
    [institutionId, deploymentId, contextId]
  )
  return rows[0] ?? null
}

/**
 * Resolves the GradeAssist course for a teacher's LTI launch of a given
 * Moodle context. First launch of a context auto-creates a course owned by
 * the launching teacher — the teacher is productive immediately; mapping the
 * context to an org_unit (for institutional reporting rollups) is a separate,
 * non-blocking concern handled later via the admin course-mapping UI.
 *
 * A known v1 limitation (see TODO.md): a co-taught Moodle course maps to
 * whichever teacher launches it first — a second instructor's launch reuses
 * the same course_id but the course row itself stays owned by the first.
 */
export async function resolveCourseForLtiLaunch(params: {
  institutionId:  string
  deploymentId:   string
  contextId:      string
  contextTitle:   string | null
  contextLabel:   string | null
  teacherId:      string
}): Promise<string> {
  const existing = await findLtiCourseLink(params.institutionId, params.deploymentId, params.contextId)

  if (existing?.course_id) {
    await pool.query(
      `UPDATE lti_course_links SET last_launch_at = NOW() WHERE id = $1`,
      [existing.id]
    )
    return existing.course_id
  }

  const course = await createCourse(params.teacherId, {
    name: params.contextTitle ?? params.contextLabel ?? 'Курс из Moodle',
    code: params.contextLabel ?? undefined,
  })

  if (existing) {
    await pool.query(
      `UPDATE lti_course_links SET course_id = $2, last_launch_at = NOW() WHERE id = $1`,
      [existing.id, course.id]
    )
  } else {
    await pool.query(
      `INSERT INTO lti_course_links
         (institution_id, deployment_id, context_id, context_title, context_label, course_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.institutionId, params.deploymentId, params.contextId,
       params.contextTitle, params.contextLabel, course.id]
    )
  }

  return course.id
}
