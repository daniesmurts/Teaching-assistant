import { chat } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findPresentationsByTeacher, createPresentation } from '../db/queries/presentations'
import type { Presentation } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateParams {
  teacherId: string
  courseId?: string
  lectureNumber?: number
  topic: string
  durationMinutes: number
  learningGoals: string[]
  audienceLevel?: string
  style?: string
  slideCountTarget?: number
}

export interface GenerateResult {
  presentation_id: string
  generated_content: string
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generatePresentation(params: GenerateParams): Promise<GenerateResult> {
  // Fetch course context if provided
  const course = params.courseId
    ? await findCourseById(params.courseId, params.teacherId)
    : null

  // Get titles of previous lectures for this course so AI avoids repetition
  const previousTopics = params.courseId
    ? await getPreviousTopics(params.teacherId, params.courseId, params.lectureNumber)
    : []

  const slideTarget = params.slideCountTarget ?? estimateSlideCount(params.durationMinutes)

  const systemPrompt =
    `Вы опытный разработчик учебных программ и методист. ` +
    `Ваша задача — создавать структурированные, содержательные и педагогически выверенные лекции. ` +
    `Пишите на русском языке, если не указано иное.`

  const userPrompt = buildPrompt(params, course, previousTopics, slideTarget)

  const content = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ])

  const presentation = await createPresentation({
    teacherId:       params.teacherId,
    courseId:        params.courseId,
    lectureNumber:   params.lectureNumber,
    topic:           params.topic,
    durationMinutes: params.durationMinutes,
    audienceLevel:   params.audienceLevel,
    learningGoals:   params.learningGoals,
    style:           params.style,
    slideCountTarget: slideTarget,
    generatedContent: content,
  })

  return { presentation_id: presentation.id, generated_content: content }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(
  params: GenerateParams,
  course: Awaited<ReturnType<typeof findCourseById>>,
  previousTopics: string[],
  slideTarget: number
): string {
  const lines: string[] = []

  // Course context
  if (course) {
    lines.push(`## Курс: ${course.name}`)
    if (course.code)  lines.push(`Код: ${course.code}`)
    if (course.level) lines.push(`Уровень: ${course.level}`)
    if (course.syllabus_text) {
      const summary = course.syllabus_text.trim().split(/\s+/).slice(0, 500).join(' ')
      lines.push(`\nАннотация программы:\n${summary}`)
    }
    lines.push('')
  }

  // Previous lectures (avoid repetition)
  if (previousTopics.length > 0) {
    lines.push(`## Предыдущие лекции (не повторять материал)`)
    previousTopics.forEach((t, i) => lines.push(`${i + 1}. ${t}`))
    lines.push('')
  }

  // Lecture parameters
  lines.push(`## Параметры лекции`)
  if (params.lectureNumber) lines.push(`Номер лекции: ${params.lectureNumber}`)
  lines.push(`Тема: ${params.topic}`)
  lines.push(`Продолжительность: ${params.durationMinutes} минут`)
  if (params.audienceLevel) lines.push(`Аудитория: ${params.audienceLevel}`)
  if (params.style)         lines.push(`Стиль подачи: ${styleLabel(params.style)}`)
  lines.push(`Целевое количество слайдов: ${slideTarget}`)

  if (params.learningGoals.length > 0) {
    lines.push(`\nЦели обучения:`)
    params.learningGoals.forEach((g) => lines.push(`- ${g}`))
  }

  // Output format — strict so the frontend can parse it
  lines.push(`
## Инструкция по формату

Создайте ровно ${slideTarget} слайдов. Используйте СТРОГО следующий формат для каждого слайда:

СЛАЙД [N]: [Заголовок слайда]
• [Тезис 1]
• [Тезис 2]
• [Тезис 3]
(3–6 тезисов на слайд; краткие, ёмкие фразы)

ЗАМЕТКИ ДОКЛАДЧИКА:
[2–4 предложения с пояснениями, примерами или советами для преподавателя]

---

Правила:
- Каждый слайд начинается с "СЛАЙД [N]:" — ровно в таком виде
- После каждого слайда обязательно ставьте разделитель "---"
- Заметки докладчика — только после ключевого слова "ЗАМЕТКИ ДОКЛАДЧИКА:"
- Первый слайд — титульный (название темы, курс, имя лектора-заглушка)
- Последний слайд — итоги и вопросы для обсуждения
- Не добавляйте ничего за пределами этого формата`)

  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getPreviousTopics(
  teacherId: string,
  courseId: string,
  currentLecture?: number
): Promise<string[]> {
  const all = await findPresentationsByTeacher(teacherId, courseId)
  return all
    .filter((p) => currentLecture == null || (p.lecture_number ?? 0) < currentLecture)
    .map((p) => (p.lecture_number ? `Лекция ${p.lecture_number}: ${p.topic}` : p.topic))
    .slice(0, 10)
}

function estimateSlideCount(minutes: number): number {
  // ~2 min per slide as a baseline; clamp to sensible range
  return Math.max(5, Math.min(30, Math.round(minutes / 2)))
}

function styleLabel(style: string): string {
  const map: Record<string, string> = {
    theory_heavy:    'Теоретический (лекция-объяснение)',
    case_study:      'Разбор кейсов',
    discussion_based:'Дискуссионный (вопросы и обсуждение)',
  }
  return map[style] ?? style
}
