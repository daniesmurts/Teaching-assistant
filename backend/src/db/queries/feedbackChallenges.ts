import { pool } from '../connection'
import type { ChallengeSourceType, ChallengeVerdict } from '../../../../shared/types'

export interface FeedbackChallengeInsert {
  teacherId:     string
  assignmentId?: string | null
  sourceType:    ChallengeSourceType
  itemRef?:      string | null
  claimText:     string
  claimQuote?:   string | null
  objection:     string
  verdict:       ChallengeVerdict
  explanation:   string
  evidenceQuote: string | null
  suggestedText: string | null
}

export async function insertFeedbackChallenge(data: FeedbackChallengeInsert): Promise<void> {
  await pool.query(
    `INSERT INTO feedback_challenges
       (teacher_id, assignment_id, source_type, item_ref, claim_text, claim_quote,
        objection, verdict, explanation, evidence_quote, suggested_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      data.teacherId,
      data.assignmentId ?? null,
      data.sourceType,
      data.itemRef ?? null,
      data.claimText,
      data.claimQuote ?? null,
      data.objection,
      data.verdict,
      data.explanation,
      data.evidenceQuote,
      data.suggestedText,
    ]
  )
}
