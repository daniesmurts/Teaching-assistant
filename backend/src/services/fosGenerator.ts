import { chatJSON } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findCriteriaByTeacher } from '../db/queries/criteria'
import { generateQuiz } from './quizzes'
import { generateTasks } from './tasks'
import { generateTickets } from './fosTickets'
import { checkCoverage, buildPassportRows } from './fosCoverage'
import { setFosStatus, setFosProgress, setFosSections, completeFosDocument, failFosDocument } from '../db/queries/fosDocuments'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { FosSections, FosCriterion, MaterialKind, Quiz, TaskSet } from '../../../shared/types'

// ФОС generator (TODO.md Feature X) orchestrator — runs inside the pg-boss
// job (see fosWorker.ts). Assembles a discipline's фонд оценочных средств
// from generators that mostly already exist: quizzes.ts and tasks.ts are
// called as-is (not forked), fosTickets.ts is the one new generator, and
// criteria are either reused from the teacher's own course-scoped criteria
// or generated fresh.
//
// v1 is teacher-scoped: topics/competencies are extracted ad hoc from
// courses.syllabus_text when the teacher doesn't supply them, with no
// controlled vocabulary and no link to the programme/org-tree competency
// model (program_disciplines.competency_codes) — that indicator-sourced
// version is the documented v2 follow-up in TODO.md Feature X.
//
// Progress is persisted after every step (7 total: extract, quiz, 3x task
// kinds, tickets, criteria) so a crash mid-run leaves earlier sections
// intact and editable rather than losing everything — same partial-progress
// posture as long-review's chapter-by-chapter persistence.

const TOTAL_STEPS = 7
const TASK_KINDS: MaterialKind[] = ['assignment', 'case', 'project']
const MAX_TOPICS_FOR_EXTRACTION = 12000   // chars of syllabus_text considered

export interface RunFosParams {
  fosId:         string
  teacherId:     string
  courseId:      string
  topics?:       string[]
  competencies?: string[]
  ticketCount?:  number
}

export async function runFosGeneration(p: RunFosParams): Promise<void> {
  await setFosStatus(p.fosId, 'processing')
  let done = 0
  const bump = async () => { done += 1; await setFosProgress(p.fosId, done, TOTAL_STEPS) }

  const course = await findCourseById(p.courseId, p.teacherId)
  if (!course) throw new Error(`Course ${p.courseId} not found for teacher ${p.teacherId}`)

  const disciplineName = course.name

  // Step 1 — topics/competencies, supplied or extracted from the syllabus.
  let topics = (p.topics ?? []).map((t) => t.trim()).filter(Boolean)
  let competencies = (p.competencies ?? []).map((c) => c.trim()).filter(Boolean)
  if (topics.length === 0 && course.syllabus_text) {
    const extracted = await extractTopicsAndCompetencies(p.teacherId, disciplineName, course.syllabus_text)
    topics = extracted.topics
    competencies = competencies.length > 0 ? competencies : extracted.competencies
  }
  if (topics.length === 0) {
    throw new Error('Не удалось определить темы дисциплины — укажите темы вручную или добавьте программу курса.')
  }
  await bump()

  const quizzes: Quiz[] = []
  const taskSets: TaskSet[] = []
  let sections: FosSections = {
    passport: { competencies, topics, rows: [] },
    quiz_ids: [], task_set_ids: [], tickets: [], criteria: [],
  }

  // Step 2 — quiz, grouped ~3 topics per question batch, application level
  // (this is a study/assessment fund, so lean toward applied questions).
  try {
    const topicBatches = chunk(topics, 3)
    for (const batch of topicBatches) {
      const { quiz } = await generateQuiz({
        teacherId: p.teacherId, courseId: p.courseId,
        topic: batch.join(', '), questionCount: Math.min(10, Math.max(5, batch.length * 3)),
        level: 'application',
      })
      quizzes.push(quiz)
    }
    sections = { ...sections, quiz_ids: quizzes.map((q) => q.id) }
    await setFosSections(p.fosId, sections)
  } catch (err) {
    logger.warn({ message: 'ФОС quiz step failed, continuing without it', fosId: p.fosId, error: (err as Error).message })
  }
  await bump()

  // Steps 3–5 — задания / кейсы / проекты, one topic-spanning set per kind.
  for (const kind of TASK_KINDS) {
    try {
      const taskSet = await generateTasks({
        teacherId: p.teacherId, kind, courseId: p.courseId,
        topic: topics.join(', '), difficulty: 'intermediate', count: 5,
      })
      taskSets.push(taskSet)
      sections = { ...sections, task_set_ids: taskSets.map((t) => t.id) }
      await setFosSections(p.fosId, sections)
    } catch (err) {
      logger.warn({ message: `ФОС ${kind} step failed, continuing without it`, fosId: p.fosId, error: (err as Error).message })
    }
    await bump()
  }

  // Step 6 — экзаменационные билеты.
  try {
    const tickets = await generateTickets({
      teacherId: p.teacherId, disciplineName, topics, ticketCount: p.ticketCount,
    })
    sections = { ...sections, tickets }
    await setFosSections(p.fosId, sections)
  } catch (err) {
    logger.warn({ message: 'ФОС tickets step failed, continuing without it', fosId: p.fosId, error: (err as Error).message })
  }
  await bump()

  // Step 7 — критерии оценивания: reuse the teacher's own course-scoped
  // criteria if any exist, else generate defaults.
  try {
    const existing = (await findCriteriaByTeacher(p.teacherId, p.courseId))
      .filter((c) => !c.is_global_template)
    const criteria = await generateCriteria(p.teacherId, disciplineName, existing.map((c) => ({ name: c.name, description: c.description })))
    sections = { ...sections, criteria }
    await setFosSections(p.fosId, sections)
  } catch (err) {
    logger.warn({ message: 'ФОС criteria step failed, continuing without it', fosId: p.fosId, error: (err as Error).message })
  }
  await bump()

  // Assemble the паспорт rows now that every instrument section is settled.
  const passportRows = buildPassportRows(topics, quizzes, taskSets, sections.tickets)
  sections = { ...sections, passport: { ...sections.passport, rows: passportRows } }

  const coverage = checkCoverage(sections, topics, competencies, quizzes, taskSets)

  await completeFosDocument(p.fosId, sections, coverage)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── Topic/competency extraction (v1 — no controlled vocabulary) ────────────

async function extractTopicsAndCompetencies(
  teacherId: string, disciplineName: string, syllabusText: string
): Promise<{ topics: string[]; competencies: string[] }> {
  const text = syllabusText.slice(0, MAX_TOPICS_FOR_EXTRACTION)

  const system =
    'Вы — методист российского вуза. Из текста рабочей программы дисциплины вы извлекаете список тем ' +
    'дисциплины и (если указаны) коды компетенций. Отвечайте только валидным JSON.'
  const user =
    `## Дисциплина\n${sanitiseForPrompt(disciplineName)}\n\n` +
    `## Текст программы\n<document>\n${sanitiseForPrompt(text)}\n</document>\n\n` +
    `## Задача\nИзвлеките 8–20 конкретных тем дисциплины (короткие названия разделов/тем, не предложения) ` +
    `и, если в тексте упоминаются коды компетенций (например ОПК-1, ПК-2, УК-3), их список.\n\n` +
    `## Формат ответа\n{"topics":["..."],"competencies":["..."]}. Только JSON.`

  const result = await chatJSON<{ topics?: unknown; competencies?: unknown }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'извлечение тем дисциплины',
    { context: { teacherId, feature: 'presentation' }, maxTokens: 1500 },
  )

  const topics = Array.isArray(result.topics)
    ? result.topics.map((t) => String(t).trim()).filter(Boolean)
    : []
  const competencies = Array.isArray(result.competencies)
    ? result.competencies.map((c) => String(c).trim()).filter(Boolean)
    : []

  return { topics, competencies }
}

// ── Criteria assembly ───────────────────────────────────────────────────────

async function generateCriteria(
  teacherId: string, disciplineName: string, existing: { name: string; description: string | null }[]
): Promise<FosCriterion[]> {
  const existingBlock = existing.length > 0
    ? existing.map((c) => `- ${sanitiseForPrompt(c.name)}${c.description ? `: ${sanitiseForPrompt(c.description)}` : ''}`).join('\n')
    : '— не заданы, используйте стандартные критерии освоения содержания дисциплины —'

  const system =
    'Вы — методист российского вуза, составляющий критерии оценивания для фонда оценочных средств (ФОС) ' +
    'по 5-балльной шкале (5/4/3/2). Отвечайте только валидным JSON.'
  const user =
    `## Дисциплина\n${sanitiseForPrompt(disciplineName)}\n\n` +
    `## Критерии преподавателя (используйте как основу, если заданы)\n${existingBlock}\n\n` +
    `## Задача\nСоставьте 3–6 критериев оценивания. Для каждого критерия дайте описание уровня для ` +
    `оценок 5 (отлично), 4 (хорошо), 3 (удовлетворительно), 2 (неудовлетворительно).\n\n` +
    `## Формат ответа\n{"criteria":[{"title":"...","scale":[{"grade":"5","description":"..."},{"grade":"4","description":"..."},` +
    `{"grade":"3","description":"..."},{"grade":"2","description":"..."}]}]}. Только JSON.`

  const result = await chatJSON<{ criteria?: { title?: string; scale?: { grade?: string; description?: string }[] }[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'критерии оценивания ФОС',
    { context: { teacherId, feature: 'presentation' }, maxTokens: 2500 },
  )

  const validGrades = new Set(['5', '4', '3', '2'])
  return (result.criteria ?? [])
    .map((c): FosCriterion | null => {
      const title = String(c.title ?? '').trim()
      const scale = (c.scale ?? [])
        .filter((s) => validGrades.has(String(s.grade)))
        .map((s) => ({ grade: String(s.grade) as FosCriterion['scale'][number]['grade'], description: String(s.description ?? '').trim() }))
        .filter((s) => s.description)
      if (!title || scale.length === 0) return null
      return { title, scale }
    })
    .filter((c): c is FosCriterion => c !== null)
}
