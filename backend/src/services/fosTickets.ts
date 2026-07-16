import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { FosTicket } from '../../../shared/types'

// ФОС generator (TODO.md Feature X) — экзаменационные билеты, the one
// generator that doesn't already exist elsewhere. Mirrors tasks.ts's
// shape/pattern: no RAG (topics come from the syllabus, already in the
// caller's context), one chatJSON call, post-validated output.
//
// The prompt instructs the model to cover every input topic across the
// ticket set, but that instruction is never trusted on its own — the
// deterministic checkCoverage() pass in fosCoverage.ts is the actual
// guarantee, same "never trust the model to self-report coverage" posture
// as calcVerifier/citationChecker.

const MIN_TICKETS = 10
const MAX_TICKETS = 30
const MAX_TOPICS  = 40

interface RawTicket { theory_questions?: string[]; practical_task?: string; topics?: string[] }

export interface GenerateTicketsParams {
  teacherId:      string
  disciplineName: string
  topics:         string[]
  ticketCount?:   number
}

export async function generateTickets(p: GenerateTicketsParams): Promise<FosTicket[]> {
  const topics = p.topics.map((t) => t.trim()).filter(Boolean).slice(0, MAX_TOPICS)
  const ticketCount = Math.min(Math.max(p.ticketCount ?? 20, MIN_TICKETS), MAX_TICKETS)

  if (topics.length === 0) {
    logger.warn({ message: 'Ticket generation called with no topics', teacherId: p.teacherId })
    return []
  }

  const topicBlock = topics.map((t, i) => `${i + 1}. ${sanitiseForPrompt(t)}`).join('\n')

  const system =
    'Вы — опытный преподаватель российского вуза, составляющий экзаменационные билеты для ' +
    'фонда оценочных средств (ФОС). Билет состоит из двух теоретических вопросов и одного ' +
    'практического задания. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(p.disciplineName)}\n\n` +
    `## Темы дисциплины\n${topicBlock}\n\n` +
    `## Задача\nСоставьте ${ticketCount} экзаменационных билетов. Каждый билет:\n` +
    `- Два теоретических вопроса ("theory_questions") — из РАЗНЫХ тем списка (не из одной и той же темы).\n` +
    `- Одно практическое задание ("practical_task") — короткая задача или ситуация, требующая применения материала.\n` +
    `- "topics" — номера или названия тем из списка выше, на которых основан этот билет.\n\n` +
    `ВАЖНО: за весь комплект билетов должна быть затронута КАЖДАЯ тема из списка хотя бы один раз ` +
    `как основной предмет вопроса, и ни одна тема не должна доминировать (избегайте, чтобы одна тема ` +
    `встречалась намного чаще остальных). Билеты не должны дословно повторять друг друга.\n\n` +
    `## Формат ответа\nВерните JSON: {"tickets":[{"theory_questions":["...","..."],"practical_task":"...","topics":["..."]}]}. ` +
    `Ровно ${ticketCount} билетов, в том же порядке, что и заданы. Только JSON.`

  const result = await chatJSON<{ tickets?: RawTicket[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'экзаменационные билеты',
    { context: { teacherId: p.teacherId, feature: 'presentation' }, maxTokens: 6000 },
  )

  const tickets = normaliseTickets(result.tickets, ticketCount)

  if (tickets.length === 0) {
    logger.warn({ message: 'Ticket generation returned no valid tickets', teacherId: p.teacherId })
  }

  return tickets
}

// Validates + cleans the model's raw output: drops tickets missing either
// theory question, renumbers sequentially 1..N. Exported so the contract is
// unit-testable without a live LLM call, same pattern as quizzes.ts's
// normaliseQuestions().
export function normaliseTickets(raw: RawTicket[] | undefined, targetCount: number): FosTicket[] {
  return (raw ?? [])
    .map((t): FosTicket | null => {
      const theory = (t.theory_questions ?? []).map((q) => String(q).trim()).filter(Boolean)
      const practical = String(t.practical_task ?? '').trim()
      const ticketTopics = (t.topics ?? []).map((x) => String(x).trim()).filter(Boolean)
      if (theory.length < 2 || !practical) return null
      return { number: 0, theory_questions: theory.slice(0, 2), practical_task: practical, topics: ticketTopics }
    })
    .filter((t): t is FosTicket => t !== null)
    .slice(0, targetCount)
    .map((t, i) => ({ ...t, number: i + 1 }))
}
