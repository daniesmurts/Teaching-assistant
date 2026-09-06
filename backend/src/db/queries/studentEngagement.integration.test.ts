import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getWritingFunnel, getLiveSessionEngagement } from './studentEngagement'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function publishAssignment(teacherId: string, courseId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO published_assignments (teacher_id, course_id, title, status, published_at)
     VALUES ($1, $2, 'Эссе', 'open', NOW()) RETURNING id`,
    [teacherId, courseId]
  )
  return rows[0].id
}

let tokenSeq = 0
async function invite(assignmentId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const cols = Object.keys(fields)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignment_invites (published_assignment_id, token${cols.length ? ', ' + cols.join(', ') : ''})
     VALUES ($1, $2${cols.map((_, i) => `, $${i + 3}`).join('')}) RETURNING id`,
    [assignmentId, `tok-${++tokenSeq}-${Date.now()}`, ...Object.values(fields)]
  )
  return rows[0].id
}

describe('getWritingFunnel', () => {
  it('separates invited from opened, started and submitted', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const pa = await publishAssignment(t.id, course.id)

    await invite(pa)                                                          // never opened the link
    await invite(pa, { consent_accepted_at: new Date() })                     // opened, wrote nothing
    await invite(pa, { consent_accepted_at: new Date(), draft_content: '{}' }) // started, never submitted
    await invite(pa, {
      consent_accepted_at: new Date(), draft_content: '{}',
      submitted_at: new Date(), status: 'submitted',
      submission_telemetry: JSON.stringify({
        total_chars: 1000, active_ms: 1_800_000, revision_count: 40,
        paste_count: 0, pasted_chars: 0, largest_paste: 0,
        started_at: new Date(Date.now() - 7_200_000).toISOString(),
        last_edit_at: new Date().toISOString(),
      }),
    })

    const f = await getWritingFunnel(90)
    expect(f.assignments_published).toBe(1)
    expect(f.invited).toBe(4)
    expect(f.opened).toBe(3)
    expect(f.started).toBe(2)
    expect(f.submitted).toBe(1)
    expect(f.graded).toBe(0)
    expect(f.median_active_minutes).toBe(30)
    expect(f.median_elapsed_hours).toBeCloseTo(2, 0)
  })

  // Paste share is a cohort-level signal about how the assignment was set,
  // never a per-student verdict — so it is a count, not a flag on a name.
  it('counts submissions that arrived mostly by paste without identifying anyone', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const pa = await publishAssignment(t.id, course.id)

    const telemetry = (pasted: number) => JSON.stringify({
      total_chars: 1000, active_ms: 60_000, revision_count: 3,
      paste_count: 1, pasted_chars: pasted, largest_paste: pasted,
      started_at: new Date().toISOString(), last_edit_at: new Date().toISOString(),
    })
    await invite(pa, { submitted_at: new Date(), submission_telemetry: telemetry(900) })
    await invite(pa, { submitted_at: new Date(), submission_telemetry: telemetry(50) })

    const f = await getWritingFunnel(90)
    expect(f.submitted).toBe(2)
    expect(f.heavy_paste_submissions).toBe(1)
    expect(Object.keys(f)).not.toContain('student_email')
  })

  it('returns a renderable zero row when nothing was published in the window', async () => {
    const f = await getWritingFunnel(90)
    expect(f.invited).toBe(0)
    expect(f.median_active_minutes).toBeNull()
  })
})

describe('getLiveSessionEngagement', () => {
  async function liveSession(teacherId: string, courseId: string) {
    const { rows: q } = await pool.query<{ id: string }>(
      `INSERT INTO quizzes (teacher_id, course_id, topic, question_count, questions)
       VALUES ($1, $2, 'Тема', 2,
         '[{"question":"a","options":["1","2"],"correct_index":0},
           {"question":"b","options":["1","2"],"correct_index":1}]'::jsonb)
       RETURNING id`,
      [teacherId, courseId]
    )
    const { rows: s } = await pool.query<{ id: string }>(
      `INSERT INTO live_sessions (teacher_id, quiz_id, join_code) VALUES ($1, $2, $3) RETURNING id`,
      [teacherId, q[0].id, `code-${Date.now()}-${Math.random()}`]
    )
    return s[0].id
  }

  it('scores answers against the quiz key by question position', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const sessionId = await liveSession(t.id, course.id)

    const { rows: p } = await pool.query<{ id: string }>(
      `INSERT INTO live_participants (session_id, participant_token) VALUES ($1, $2) RETURNING id`,
      [sessionId, `p-${Date.now()}`]
    )
    // Q0 answered correctly (key 0), Q1 answered wrongly (key 1).
    await pool.query(
      `INSERT INTO live_answers (session_id, participant_id, question_index, choice_index)
       VALUES ($1, $2, 0, 0), ($1, $2, 1, 0)`,
      [sessionId, p[0].id]
    )

    const e = await getLiveSessionEngagement(90)
    expect(e.sessions_run).toBe(1)
    expect(e.participants).toBe(1)
    expect(e.answers).toBe(2)
    expect(e.correct_answers).toBe(1)
  })

  // A lobby nobody joined is a different failure from a session that ran badly.
  it('counts sessions nobody joined separately', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await liveSession(t.id, course.id)

    const e = await getLiveSessionEngagement(90)
    expect(e.sessions_run).toBe(1)
    expect(e.sessions_empty).toBe(1)
    expect(e.median_participants).toBeNull()
  })

  it('returns zeros rather than throwing when no session ran', async () => {
    const e = await getLiveSessionEngagement(90)
    expect(e.sessions_run).toBe(0)
    expect(e.answers).toBe(0)
  })
})
