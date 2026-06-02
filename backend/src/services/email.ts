import { chat } from './deepseek'
import { findAssignmentById } from '../db/queries/assignments'

type Tone = 'encouraging' | 'neutral' | 'direct'

export interface EmailDraft {
  subject: string
  body: string
}

export async function generateEmailDraft(
  assignmentId: string,
  teacherId: string,
  tone: Tone = 'neutral'
): Promise<EmailDraft> {
  const assignment = await findAssignmentById(assignmentId, teacherId)
  if (!assignment) throw Object.assign(new Error('Assignment not found'), { status: 404 })

  const score = assignment.approved_score ?? assignment.ai_score
  const grade = assignment.approved_grade ?? assignment.ai_grade
  const feedback = assignment.approved_feedback ?? assignment.ai_feedback ?? ''
  const studentName = assignment.student_name ?? 'Student'

  const toneGuide: Record<Tone, string> = {
    encouraging: 'warm, supportive, and encouraging — celebrate effort and frame improvements positively',
    neutral: 'professional and objective — factual without being cold',
    direct: 'concise and direct — brief, clear, no fluff',
  }

  const prompt = `Write a feedback email from a university lecturer to a student.

Tone: ${toneGuide[tone]}
Student name: ${studentName}
Grade: ${grade} (${score}/100)
Overall feedback: ${feedback}
Strengths: ${(assignment.ai_strengths ?? []).join('; ')}
Areas to improve: ${(assignment.ai_improvements ?? []).join('; ')}

Write the email in the same language as the feedback text above.
Return ONLY two lines:
SUBJECT: <subject line>
BODY:
<email body>`

  const raw = await chat([
    {
      role: 'system',
      content: 'You are a university lecturer writing feedback emails to students. Write clearly and professionally.',
    },
    { role: 'user', content: prompt },
  ])

  return parseEmailResponse(raw)
}

function parseEmailResponse(raw: string): EmailDraft {
  const subjectMatch = raw.match(/^SUBJECT:\s*(.+)/m)
  const bodyMatch = raw.match(/^BODY:\s*\n([\s\S]+)/m)

  return {
    subject: subjectMatch?.[1]?.trim() ?? 'Your assignment feedback',
    body: bodyMatch?.[1]?.trim() ?? raw.trim(),
  }
}
