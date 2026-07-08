import { pool } from '../connection'

export interface LtiLineItemRow {
  id:                       string
  lti_course_link_id:       string
  lineitem_url:             string
  published_assignment_id:  string | null
  created_at:               Date
}

/**
 * Records the AGS lineitem URL for a published assignment the first time we
 * see it in a launch's endpoint claim (typically the student's first launch
 * of a Deep-Linked activity that requested a lineItem). Idempotent — later
 * launches of the same resource link just no-op if a row already exists.
 * Consumed by the (later) grade write-back milestone.
 */
export async function recordLineItemIfAbsent(params: {
  ltiCourseLinkId:        string
  lineitemUrl:            string
  publishedAssignmentId:  string | null
}): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM lti_line_items
      WHERE lti_course_link_id = $1
        AND published_assignment_id IS NOT DISTINCT FROM $2
      LIMIT 1`,
    [params.ltiCourseLinkId, params.publishedAssignmentId]
  )
  if (rows[0]) return

  await pool.query(
    `INSERT INTO lti_line_items (lti_course_link_id, lineitem_url, published_assignment_id)
     VALUES ($1, $2, $3)`,
    [params.ltiCourseLinkId, params.lineitemUrl, params.publishedAssignmentId]
  )
}

export interface LtiGradeSyncTarget {
  institutionId:  string
  lineitemUrl:    string
  ltiSubject:     string
}

/**
 * Resolves everything grade write-back needs from a just-approved
 * `assignments` row: the student's LMS user id (captured at their launch)
 * and the AGS lineitem URL (captured the same way) — joined through the
 * invite that produced this assignment and the course link that produced
 * the line item. Returns null for any assignment not sourced from an LTI
 * student launch (the overwhelming majority, still) — a normal, silent skip.
 */
export async function findLtiGradeSyncTarget(assignmentId: string): Promise<LtiGradeSyncTarget | null> {
  const { rows } = await pool.query<LtiGradeSyncTarget & { institutionId: string }>(
    `SELECT lcl.institution_id AS "institutionId",
            li.lineitem_url    AS "lineitemUrl",
            i.lti_subject      AS "ltiSubject"
       FROM assignment_invites i
       JOIN lti_line_items  li  ON li.published_assignment_id = i.published_assignment_id
       JOIN lti_course_links lcl ON lcl.id = li.lti_course_link_id
      WHERE i.assignment_id = $1
        AND i.lti_subject IS NOT NULL
      LIMIT 1`,
    [assignmentId]
  )
  return rows[0] ?? null
}
