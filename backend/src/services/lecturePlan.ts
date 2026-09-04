import { chatJSON } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { replaceLectureTopics } from '../db/queries/lectureTopics'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { ValidationError } from '../errors/AppError'
import type { LectureTopic } from '../../../shared/types'

// Тематический план extraction (TODO.md "### AO" Phase 3).
//
// Until now a teacher retyped the topic and the lecture number for every deck,
// while the course's own РПД already listed both, in order. This reads that
// list out of the programme once, so the presentation form can offer it.
//
// One cheap call, run on demand and persisted — not on every generation. The
// programme text is long, the plan changes maybe once a year, and re-reading
// it per deck would be paying repeatedly for an answer that doesn't move.

const MAX_TOPICS       = 60      // a semester of lectures, matching MAX_SLIDE_COUNT's "past this it isn't a lecture course" posture
const MAX_PROGRAMME_CHARS = 24_000
const TITLE_MAX        = 200
const DESCRIPTION_MAX  = 600

export interface ExtractLecturePlanParams {
  courseId:      string
  teacherId:     string
  institutionId?: string
}

export async function extractLecturePlan(params: ExtractLecturePlanParams): Promise<LectureTopic[]> {
  const course = await findCourseById(params.courseId, params.teacherId)
  if (!course) throw new ValidationError('Предмет не найден')

  // Inline syllabus text first, then the latest uploaded syllabus/material —
  // the same fallback order the curriculum overlap analysis uses, and the
  // reason a teacher who uploaded their РПД as a file rather than pasting it
  // isn't told they have no programme.
  const programme = course.syllabus_text?.trim()
    || (await getLatestKnowledgeText(params.courseId, params.teacherId))?.trim()
    || ''

  if (programme.length < 200) {
    throw new ValidationError(
      'У этого предмета нет программы, из которой можно взять тематический план — ' +
      'загрузите РПД или вставьте текст программы в карточке предмета.'
    )
  }

  const raw = await chatJSON<{ topics: unknown[] }>(
    [
      {
        role: 'system',
        content:
          `Вы методист, читающий рабочую программу дисциплины. ` +
          `Вы извлекаете из неё тематический план — перечень тем лекций в том порядке, ` +
          `в каком они читаются. Вы ничего не придумываете: если темы в программе нет, её нет и в ответе. ` +
          `Отвечайте строго в формате JSON.`,
      },
      { role: 'user', content: buildPrompt(course.name, programme) },
    ],
    'тематический план',
    {
      context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'presentation' },
      maxTokens: 4000,
    },
  )

  const topics = normaliseLecturePlan(raw?.topics)
  if (topics.length === 0) {
    throw new ValidationError(
      'Не удалось найти тематический план в программе этого предмета — ' +
      'возможно, в загруженном документе нет раздела с темами лекций.'
    )
  }

  return replaceLectureTopics(params.courseId, params.teacherId, topics)
}

function buildPrompt(courseName: string, programme: string): string {
  return `## Предмет: ${courseName}

## Текст рабочей программы
${sanitiseForPrompt(programme.slice(0, MAX_PROGRAMME_CHARS))}

## Задача

Извлеките тематический план — список тем лекций по порядку. Обычно он находится
в разделе «Содержание дисциплины», «Тематический план» или «Разделы дисциплины».

- Берите формулировки тем ИЗ ПРОГРАММЫ, не переписывайте их своими словами.
- Одна тема — один элемент списка, в том порядке, в каком они идут в программе.
- Если раздел делится на темы, перечисляйте темы, а не разделы.
- НЕ включайте практические, лабораторные работы, СРС, экзамен и промежуточную
  аттестацию — только то, что читается как лекция.
- Если тематического плана в тексте нет, верните пустой массив. Не придумывайте темы.

Верните JSON: { "topics": [ { "title": "...", "description": "..." } ] }
- "title" — формулировка темы из программы.
- "description" — краткое содержание темы, если программа его даёт; иначе пустая строка.

Верните строго JSON без обрамляющего текста.`
}

/**
 * Coerces the model's list into storable rows. Exported for testing: the
 * failure that matters here is a plan that looks plausible but contains the
 * practicals and the exam the prompt asked it to leave out, and the only
 * thing this layer can enforce is shape.
 */
export function normaliseLecturePlan(
  raw: unknown,
): Array<{ title: string; description: string | null; source: 'syllabus' }> {
  if (!Array.isArray(raw)) return []

  const out: Array<{ title: string; description: string | null; source: 'syllabus' }> = []
  const seen = new Set<string>()

  for (const entry of raw.slice(0, MAX_TOPICS)) {
    const o = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().replace(/^\d+[.)]\s*/, '') : ''
    if (!title) continue

    // A programme that lists the same тема in the plan and again in the
    // assessment section would otherwise produce it twice, and the teacher
    // would pick the wrong one half the time.
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const description = typeof o.description === 'string' ? o.description.trim() : ''
    out.push({
      title:       title.slice(0, TITLE_MAX),
      description: description ? description.slice(0, DESCRIPTION_MAX) : null,
      source:      'syllabus',
    })
  }

  return out
}
