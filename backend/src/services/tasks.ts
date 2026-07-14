import { chatJSON } from './deepseek'
import { createTaskSet } from '../db/queries/tasks'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { pool } from '../db/connection'
import { logger } from '../lib/logger'
import type { TaskItem, TaskSet, MaterialKind } from '../../../shared/types'

// КНИТУ teacher feature T1 — practical-material generator. One code path, three
// kinds (задания / кейсы / проекты): the item shape is shared, the prompt differs.
// Pulls a little course context like the topics generator; no uploaded docs/RAG.

const DIFFICULTY_RU: Record<string, string> = {
  basic:        'базовый — отработка основных понятий и типовых действий',
  intermediate: 'средний — применение в практических ситуациях, многошаговые задачи',
  advanced:     'продвинутый — нестандартные задачи, анализ, проектные элементы',
}

// Per-kind framing: the noun, the persona spin, and what "statement" should contain.
// `professionClause` scales how hard each kind leans on profession context (see
// Research.md §8.3) — strongest for кейсы/проекты, which are workplace situations
// by nature, lighter for задания.
const KIND: Record<MaterialKind, {
  noun: string; unit: string; statementSpec: string; guidanceSpec: string; professionClause: string
}> = {
  assignment: {
    noun: 'практических заданий',
    unit: 'задание',
    statementSpec: 'условие — что именно должен сделать студент (2–5 предложений)',
    guidanceSpec: 'краткая подсказка или ожидаемый результат для преподавателя (1–2 предложения)',
    professionClause: 'где уместно, формулируйте условие через задачу, близкую к работе такого специалиста',
  },
  case: {
    noun: 'учебных кейсов (case-study)',
    unit: 'кейс',
    statementSpec: 'описание ситуации/контекста (3–6 предложений), а затем 2–4 вопроса для разбора',
    guidanceSpec: 'ключевые выводы и на что обратить внимание при разборе (1–3 предложения)',
    professionClause: 'постройте ситуацию как реальный рабочий случай из практики такого специалиста',
  },
  project: {
    noun: 'проектных заданий',
    unit: 'проект',
    statementSpec: 'цель проекта, что нужно сделать, ожидаемый результат и основные этапы',
    guidanceSpec: 'критерии оценки и подсказка для преподавателя (1–3 предложения)',
    professionClause: 'сформулируйте проект как задачу, которую такой специалист мог бы решать на практике',
  },
}

interface GenerateParams {
  teacherId:  string
  kind:       MaterialKind
  courseId?:  string
  topic:      string
  difficulty: string
  count?:     number
}

export async function generateTasks(p: GenerateParams): Promise<TaskSet> {
  const count = Math.min(Math.max(p.count ?? 5, 1), 10)
  const k = KIND[p.kind] ?? KIND.assignment

  // Pull a little course context if linked (same as the topics generator).
  let context = ''
  let professionContext = ''
  if (p.courseId) {
    try {
      const { rows } = await pool.query<{ syllabus_text: string | null; name: string; profession_context: string | null }>(
        `SELECT name, syllabus_text, profession_context FROM courses WHERE id = $1 AND teacher_id = $2`, [p.courseId, p.teacherId]
      )
      if (rows[0]) {
        context = `Предмет: ${rows[0].name}. ${(rows[0].syllabus_text ?? '').slice(0, 600)}`
        professionContext = rows[0].profession_context ?? ''
      }
    } catch { /* non-fatal */ }
  }

  const difficultyRu = DIFFICULTY_RU[p.difficulty] ?? p.difficulty

  const system =
    'Вы — опытный преподаватель российского вуза. Вы составляете учебные материалы для ' +
    'студентов: конкретные, выполнимые, с ясной учебной целью и привязкой к теме. ' +
    'Отвечайте только валидным JSON на русском языке.'

  // Profession-anchored generation — see Research.md §8. With a stated profession,
  // instruct the model to frame content in that workplace; without one, fall back
  // to a soft clause rather than fabricating a profession.
  const professionSection = professionContext
    ? `## Профессиональный контекст\nВыпускники этого предмета работают как: ${sanitiseForPrompt(professionContext)}.\n` +
      `При составлении материалов, ${k.professionClause}.\n\n`
    : `## Профессиональный контекст\nЕсли из темы или контекста предмета очевидна профессия, для которой готовятся ` +
      `студенты, привязывайте материалы к рабочим ситуациям этой профессии. Не выдумывайте профессию, если она не очевидна.\n\n`

  const user =
    `## Тема\n${sanitiseForPrompt(p.topic)}\n\n` +
    `## Уровень сложности\n${difficultyRu}\n\n` +
    (context ? `## Контекст предмета\n${sanitiseForPrompt(context)}\n\n` : '') +
    professionSection +
    `## Задача\nСоставьте ${count} ${k.noun} по теме. Они должны различаться и охватывать ` +
    `разные аспекты темы.\n\n` +
    `## Формат ответа\nВерните JSON: {"tasks":[ ... ]}, где каждый элемент:\n` +
    `- "title": короткое название (${k.unit})\n` +
    `- "statement": ${k.statementSpec}\n` +
    `- "skills": какие умения/компетенции развивает — по возможности свяжите с задачами профессии, ` +
    `а не только с абстрактной компетенцией (1 строка)\n` +
    `- "guidance": ${k.guidanceSpec}\n` +
    `Ответьте ТОЛЬКО JSON-объектом.`

  const result = await chatJSON<{ tasks: TaskItem[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'список материалов',
    { context: { teacherId: p.teacherId, feature: 'presentation' } },   // reuse a logged generation bucket
  )

  const tasks = (result.tasks ?? []).slice(0, count).map((t) => ({
    title:     String(t.title ?? '').trim(),
    statement: String(t.statement ?? '').trim(),
    skills:    String(t.skills ?? '').trim(),
    guidance:  t.guidance ? String(t.guidance).trim() : undefined,
  })).filter((t) => t.title && t.statement)

  if (tasks.length === 0) {
    logger.warn({ message: 'Material generation returned no items', teacherId: p.teacherId, kind: p.kind })
  }

  return createTaskSet({
    teacherId: p.teacherId, courseId: p.courseId, kind: p.kind,
    topic: p.topic, difficulty: p.difficulty, tasks,
  })
}
