import { chat } from './deepseek'
import { findAssignmentById } from '../db/queries/assignments'
import { findTeacherById } from '../db/queries/teachers'
import { NotFoundError } from '../errors/AppError'

type Tone = 'encouraging' | 'neutral' | 'direct'

export interface EmailDraft {
  subject: string
  body: string
}

/**
 * Extract the Russian-academic signature line from a teacher's full name.
 * Registration captures "Полное имя" as Фамилия Имя Отчество — for letter
 * signatures the convention is Имя Отчество (second + third words). Falls
 * back gracefully for partial entries.
 */
export function extractSignatureName(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length >= 3) return `${parts[1]} ${parts[2]}`   // Имя Отчество
  return parts.join(' ')                                    // 1 or 2 words — use as-is
}

export async function generateEmailDraft(
  assignmentId: string,
  teacherId: string,
  tone: Tone = 'neutral'
): Promise<EmailDraft> {
  const [assignment, teacher] = await Promise.all([
    findAssignmentById(assignmentId, teacherId),
    findTeacherById(teacherId),
  ])
  if (!assignment) throw new NotFoundError('Работа')

  const score       = assignment.approved_score    ?? assignment.ai_score
  const grade       = assignment.approved_grade    ?? assignment.ai_grade
  const feedback    = assignment.approved_feedback ?? assignment.ai_feedback ?? ''
  const studentName = assignment.student_name ?? 'Студент'
  const signature   = extractSignatureName(teacher?.name) ?? 'Ваш преподаватель'

  const toneGuide: Record<Tone, string> = {
    encouraging: 'тёплый, поддерживающий — отмечайте усилия студента и формулируйте замечания позитивно',
    neutral:     'профессиональный и объективный — по делу, без излишней холодности',
    direct:      'краткий и деловой — чётко, без воды',
  }

  const prompt =
    `Напишите письмо с обратной связью от преподавателя студенту.\n\n` +
    `Тон: ${toneGuide[tone]}\n` +
    `Имя студента: ${studentName}\n` +
    `Оценка: ${grade} (${score}/100)\n` +
    `Общий отзыв: ${feedback}\n` +
    `Достоинства работы: ${(assignment.ai_strengths ?? []).join('; ')}\n` +
    `Что улучшить: ${(assignment.ai_improvements ?? []).join('; ')}\n\n` +
    `Напишите письмо на русском языке. Завершите письмо подписью ` +
    `«С уважением,\\n${signature}» — используйте именно это имя, ` +
    `не заменяйте плейсхолдером и не добавляйте должность или университет.\n` +
    `Верните ТОЛЬКО следующие строки:\n` +
    `SUBJECT: <тема письма>\n` +
    `BODY:\n` +
    `<текст письма>`

  const raw = await chat(
    [
      {
        role:    'system',
        content: 'Вы преподаватель университета, пишущий письма с обратной связью студентам. Пишите на русском языке, чётко и профессионально.',
      },
      { role: 'user', content: prompt },
    ],
    { context: { teacherId, feature: 'feedback_email' } }
  )

  return parseEmailResponse(raw)
}

function parseEmailResponse(raw: string): EmailDraft {
  const subjectMatch = raw.match(/^SUBJECT:\s*(.+)/m)
  const bodyMatch    = raw.match(/^BODY:\s*\n([\s\S]+)/m)
  return {
    subject: subjectMatch?.[1]?.trim() ?? 'Обратная связь по вашей работе',
    body:    bodyMatch?.[1]?.trim()    ?? raw.trim(),
  }
}
