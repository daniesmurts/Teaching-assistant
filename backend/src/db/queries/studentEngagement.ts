import { pool } from '../connection'
import type { WritingFunnel, LiveSessionEngagement } from '../../../../shared/types'

// ─── Student-side engagement (aggregate only) ────────────────────────────────
//
// The two surfaces students actually touch inside ИСПУМ: the published-
// assignment writing workspace (§5.1) and live quiz sessions. Everything else
// the platform generates — тесты as a file, задания, темы — leaves as an
// export and is never seen again, so no amount of instrumentation can report
// student completion for those. That is a product gap, not a metrics gap.
//
// Aggregate only, deliberately and permanently: no student name, e-mail,
// token or per-student row leaves these queries. The attestation design
// committed to aggregate-only telemetry (Research.md §5.1.2), and a platform
// admin building a behavioural profile of a named student is exactly what
// that commitment rules out. Counts and medians across a cohort carry the
// product signal without identifying anyone.

/**
 * Invited → opened → started writing → submitted → graded → approved, plus
 * how long the work actually took.
 *
 * "Opened" is consent, not a page view: a student cannot reach the editor
 * without accepting the consent gate, so `consent_accepted_at` is the first
 * honest evidence that the link was followed.
 */
export async function getWritingFunnel(days = 90): Promise<WritingFunnel> {
  const { rows } = await pool.query<WritingFunnel>(
    `WITH pa AS (
       SELECT id FROM published_assignments
        WHERE published_at IS NOT NULL
          AND published_at >= NOW() - ($1 || ' days')::INTERVAL
     ),
     inv AS (
       SELECT i.*, a.approved_at
         FROM assignment_invites i
         JOIN pa            ON pa.id = i.published_assignment_id
         LEFT JOIN assignments a ON a.id = i.assignment_id
     )
     SELECT
       (SELECT COUNT(*) FROM pa)::int                                             AS assignments_published,
       COUNT(*)::int                                                              AS invited,
       COUNT(*) FILTER (WHERE consent_accepted_at IS NOT NULL)::int               AS opened,
       COUNT(*) FILTER (WHERE draft_content IS NOT NULL OR submitted_at IS NOT NULL)::int AS started,
       COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int                      AS submitted,
       COUNT(*) FILTER (WHERE assignment_id IS NOT NULL)::int                     AS graded,
       COUNT(*) FILTER (WHERE approved_at IS NOT NULL)::int                       AS approved,
       -- Active editing time with idle gaps already excluded by the client —
       -- the closest thing to "how long this actually took" the platform has.
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY ((submission_telemetry->>'active_ms')::numeric / 60000)
       ) FILTER (WHERE submission_telemetry->>'active_ms' IS NOT NULL))::numeric, 1)::float
                                                                                  AS median_active_minutes,
       -- Wall-clock from first keystroke to submit: median_active_minutes says
       -- how much work it was, this says how long they sat with it.
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM submitted_at - (submission_telemetry->>'started_at')::timestamptz) / 3600
       ) FILTER (WHERE submitted_at IS NOT NULL AND submission_telemetry->>'started_at' IS NOT NULL))::numeric, 1)::float
                                                                                  AS median_elapsed_hours,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY (submission_telemetry->>'revision_count')::numeric
       ) FILTER (WHERE submission_telemetry->>'revision_count' IS NOT NULL))::numeric, 0)::float
                                                                                  AS median_revisions,
       -- Share of submissions where most of the text arrived by paste. Read as
       -- a cohort-level signal about the assignment design, never as a verdict
       -- on a student — the same framing the teacher-facing process report uses.
       COUNT(*) FILTER (
         WHERE (submission_telemetry->>'total_chars')::numeric > 0
           AND (submission_telemetry->>'pasted_chars')::numeric
               / NULLIF((submission_telemetry->>'total_chars')::numeric, 0) > 0.5
       )::int                                                                     AS heavy_paste_submissions
     FROM inv`,
    [days]
  )
  return rows[0]
}

/**
 * Live quiz sessions: did the class actually join, answer, and get it right.
 *
 * Correctness is the one genuine *learning outcome* signal on the platform —
 * every other metric measures teacher effort. Resolved by indexing the quiz's
 * questions JSONB at the answered position, since live_answers stores the
 * chosen index rather than a correctness flag.
 */
export async function getLiveSessionEngagement(days = 90): Promise<LiveSessionEngagement> {
  const { rows } = await pool.query<LiveSessionEngagement>(
    `WITH s AS (
       SELECT id, quiz_id, finished_at FROM live_sessions
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     ),
     participants AS (
       SELECT s.id AS session_id, COUNT(p.id)::int AS n
         FROM s LEFT JOIN live_participants p ON p.session_id = s.id
        GROUP BY s.id
     ),
     answers AS (
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE (q.questions -> la.question_index ->> 'correct_index')::int = la.choice_index
              )::int AS correct
         FROM live_answers la
         JOIN s              ON s.id = la.session_id
         JOIN live_sessions ls ON ls.id = la.session_id
         JOIN quizzes q      ON q.id = ls.quiz_id
     )
     SELECT
       (SELECT COUNT(*) FROM s)::int                                   AS sessions_run,
       (SELECT COUNT(*) FROM s WHERE finished_at IS NOT NULL)::int     AS sessions_finished,
       -- A session nobody joined is a teacher who opened the lobby and gave
       -- up — a different failure from a session that ran and went badly.
       (SELECT COUNT(*) FROM participants WHERE n = 0)::int            AS sessions_empty,
       (SELECT COALESCE(SUM(n), 0) FROM participants)::int             AS participants,
       (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n)::numeric, 1)::float
          FROM participants WHERE n > 0)                               AS median_participants,
       (SELECT total FROM answers)                                     AS answers,
       (SELECT correct FROM answers)                                   AS correct_answers
     FROM s
     LIMIT 1`,
    [days]
  )
  // No sessions in the window: the outer SELECT ... FROM s yields no row at
  // all, but the page still needs a shape to render zeros into.
  return rows[0] ?? {
    sessions_run: 0, sessions_finished: 0, sessions_empty: 0,
    participants: 0, median_participants: null, answers: 0, correct_answers: 0,
  }
}
