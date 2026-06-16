import { chatJSON } from './deepseek'
import { findAssignmentById, saveHandout } from '../db/queries/assignments'
import { findTeacherById } from '../db/queries/teachers'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { extractSignatureName } from './email'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'

type Tone = 'encouraging' | 'neutral' | 'direct'

export interface HandoutDraft {
  subject: string
  body:    string
}

/**
 * Compose a "доработка" handout the teacher can paste into an email or hand to
 * the student. Pulls together the teacher-selected improvement bullets and
 * verification questions into a single coherent text — framed as guidance for
 * the next iteration of the work, not punishment.
 *
 * Inputs are sent as plain strings (not bullet ids) so the teacher can edit
 * their selection inline in the modal before sending — the backend doesn't
 * need to re-resolve anything on the assignment row.
 */
export async function composeHandout(params: {
  assignmentId: string
  teacherId:    string
  improvements: string[]              // teacher-curated subset of improvement bullets
  questions:    string[]              // teacher-curated subset of verification / follow-up questions
  tone:         Tone
}): Promise<HandoutDraft> {
  const [assignment, teacher] = await Promise.all([
    findAssignmentById(params.assignmentId, params.teacherId),
    findTeacherById(params.teacherId),
  ])
  if (!assignment) throw new NotFoundError('Работа')

  const trimmedImprovements = params.improvements.map((s) => s.trim()).filter(Boolean)
  const trimmedQuestions    = params.questions.map((s) => s.trim()).filter(Boolean)
  if (trimmedImprovements.length === 0 && trimmedQuestions.length === 0) {
    throw new ValidationError('Нужно выбрать хотя бы один пункт или вопрос для доработки')
  }

  const studentName = assignment.student_name ?? 'студент'
  const signature   = extractSignatureName(teacher?.name) ?? teacher?.name ?? 'преподаватель'

  const toneGuide: Record<Tone, string> = {
    encouraging: 'мягкий и поддерживающий — отмечает прогресс, поощряет доработку',
    neutral:     'академичный и нейтральный — по делу, без излишней холодности',
    direct:      'краткий и деловой — без лишних слов, чётко по пунктам',
  }

  const improvementsBlock = trimmedImprovements.length > 0
    ? `Пункты для доработки:\n${trimmedImprovements.map((s, i) => `${i + 1}. ${sanitiseForPrompt(s)}`).join('\n')}\n`
    : ''
  const questionsBlock = trimmedQuestions.length > 0
    ? `Вопросы к студенту:\n${trimmedQuestions.map((s, i) => `${i + 1}. ${sanitiseForPrompt(s)}`).join('\n')}\n`
    : ''

  const system =
    `Вы — преподаватель университета, готовящий пакет «доработки» для студента. ` +
    `Тон: ${toneGuide[params.tone]}. Текст должен быть конструктивным, давать студенту понятный план ` +
    `действий и указывать, на какие вопросы нужно ответить устно или письменно. ` +
    `Не обвиняйте студента в использовании ИИ. Подпись в конце письма — «С уважением, ${signature}». ` +
    `Отвечайте только валидным JSON.`

  const user =
    `Имя студента: ${studentName}
${improvementsBlock}${questionsBlock}
Составьте письмо/документ на русском языке. Структура: краткое вступление (1–2 предложения), ` +
    `пункты для доработки списком, отдельным блоком вопросы к студенту, заключение с инструкцией ` +
    `(когда и как ответить). Без обвинительных формулировок.

Верните JSON: {"subject": "тема письма (до 80 символов)", "body": "текст письма на русском"}`

  const r = await chatJSON<{ subject?: string; body?: string }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'доработка',
    {
      context:   { teacherId: params.teacherId, feature: 'feedback_email' },   // reuse the email-bucket usage tag
      maxTokens: 2048,
    },
  )

  const subject = (r.subject ?? 'Доработка работы').trim().slice(0, 200)
  const body    = (r.body    ?? '').trim()

  // Persist as the revision contract — when the student resubmits and the
  // teacher grades the new version as a revision of this row, the AI checks
  // these specific improvements + questions instead of the broader bullets
  // list. Fire-and-forget: a failure to persist shouldn't lose the draft the
  // teacher is about to copy.
  saveHandout(params.assignmentId, params.teacherId, {
    improvements: trimmedImprovements,
    questions:    trimmedQuestions,
    subject,
    body,
    tone:         params.tone,
    created_at:   new Date().toISOString(),
  }).catch((err) => logger.warn({ message: 'Failed to persist handout', error: (err as Error).message }))

  return { subject, body }
}
