import type { FosSections, FosCoverageReport, FosPassportRow, FosTicket, Quiz, TaskSet } from '../../../shared/types'

// Deterministic (no-LLM) coverage self-check for the ФОС generator (TODO.md
// Feature X). fosTickets.ts's prompt instructs the model to cover every
// topic, but that instruction is never trusted on its own — this is the
// actual guarantee, same "never trust the model to self-report coverage"
// posture as calcVerifier/citationChecker's validators.
//
// Matching is pragmatic case-insensitive substring/token overlap, same style
// as cohortAnalytics.ts's criterion-name matching — topics are free text
// (v1 has no controlled vocabulary), not FK-based IDs.

const BALANCE_THRESHOLD = 0.5   // a topic in >50% of tickets is flagged as dominating

function normalise(s: string): string {
  return s.trim().toLowerCase()
}

// Crude Russian-noun-ending tolerance: comparing whole words would miss
// "гидравлика" (topic) against "гидравлике" (haystack, dative case) — strip
// the last 1-2 characters before substring-matching so common case endings
// don't cause false negatives. Only applied to words long enough that
// trimming still leaves a meaningfully specific stem.
function stem(word: string): string {
  if (word.length >= 6) return word.slice(0, -2)
  return word
}

// A topic is "mentioned" in a haystack if the topic's own text, or the stem
// of a sufficiently specific word from it, appears in the haystack. The
// length-5 floor on individual words keeps short generic words (adjectives,
// connectives) from causing false-positive matches across unrelated topics.
function topicMentioned(topic: string, haystack: string): boolean {
  const t = normalise(topic)
  if (!t) return false
  if (haystack.includes(t)) return true
  const words = t.split(/\s+/).filter((w) => w.length >= 5)
  return words.some((w) => haystack.includes(stem(w)))
}

function collectQuizHaystack(quizzes: Quiz[]): string {
  return quizzes
    .flatMap((q) => q.questions.map((qq) => `${qq.question} ${qq.explanation}`))
    .join(' ')
    .toLowerCase()
}

function collectTaskHaystack(taskSets: TaskSet[]): string {
  return taskSets
    .flatMap((ts) => ts.tasks.map((t) => `${t.title} ${t.statement} ${t.skills}`))
    .join(' ')
    .toLowerCase()
}

function collectTicketHaystack(sections: FosSections): string {
  return sections.tickets
    .flatMap((t) => [...t.theory_questions, t.practical_task, ...t.topics])
    .join(' ')
    .toLowerCase()
}

export function checkCoverage(
  sections: FosSections,
  allTopics: string[],
  allCompetencies: string[],
  quizzes: Quiz[] = [],
  taskSets: TaskSet[] = [],
): FosCoverageReport {
  const haystack = [
    collectQuizHaystack(quizzes),
    collectTaskHaystack(taskSets),
    collectTicketHaystack(sections),
  ].join(' ')

  const topics_covered:   string[] = []
  const topics_uncovered: string[] = []
  for (const topic of allTopics) {
    (topicMentioned(topic, haystack) ? topics_covered : topics_uncovered).push(topic)
  }

  const passportHaystack = sections.passport.rows.map((r) => `${r.competency ?? ''} ${r.topic}`).join(' ').toLowerCase()
  const competencies_uncovered = allCompetencies.filter((c) => !topicMentioned(c, passportHaystack))

  const balance_warning = findBalanceWarning(sections)

  return { topics_covered, topics_uncovered, competencies_uncovered, balance_warning }
}

// Assembles the паспорт ФОС rows — for each topic, which instrument types
// (quiz, task/case/project, specific ticket numbers) actually reference it.
// v1 has no topic-competency link model (see fosGenerator.ts's header
// comment), so `competency` is always null here — the passport's
// `competencies` list is tracked separately, flat, not per-topic.
export function buildPassportRows(
  topics: string[],
  quizzes: Quiz[],
  taskSets: TaskSet[],
  tickets: FosTicket[],
): FosPassportRow[] {
  const quizHay = collectQuizHaystack(quizzes)
  const taskHay = collectTaskHaystack(taskSets)

  return topics.map((topic): FosPassportRow => {
    const instruments: string[] = []
    if (topicMentioned(topic, quizHay)) instruments.push('Тест')
    if (topicMentioned(topic, taskHay)) instruments.push('Практическое задание/кейс/проект')

    const ticketNumbers = tickets
      .filter((t) => topicMentioned(topic, [...t.theory_questions, t.practical_task, ...t.topics].join(' ').toLowerCase()))
      .map((t) => t.number)
    if (ticketNumbers.length > 0) instruments.push(`Билет №${ticketNumbers.join(', №')}`)

    return { competency: null, topic, instruments }
  })
}

// Flags a topic that dominates the ticket set — a crude imbalance signal,
// not a full distribution analysis (matches the plan's v1 scope).
function findBalanceWarning(sections: FosSections): string | null {
  const total = sections.tickets.length
  if (total === 0) return null

  const counts = new Map<string, number>()   // normalised key -> count
  const original = new Map<string, string>() // normalised key -> first-seen original casing
  for (const ticket of sections.tickets) {
    const seenKeys = new Set(ticket.topics.map(normalise))
    for (const key of seenKeys) counts.set(key, (counts.get(key) ?? 0) + 1)
    for (const topic of ticket.topics) if (!original.has(normalise(topic))) original.set(normalise(topic), topic)
  }

  for (const [key, count] of counts) {
    if (count / total > BALANCE_THRESHOLD) {
      return `Тема «${original.get(key) ?? key}» встречается в ${count} из ${total} билетов — рассмотрите более равномерное распределение тем.`
    }
  }
  return null
}
