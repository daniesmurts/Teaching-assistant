import { chat, embed } from './llm/registry'
import { findRelevantChunksScored, type ScoredChunk } from '../db/queries/chunks'
import { logDocumentRetrievals } from '../db/queries/ragDocumentUses'
import { resolveRagRetrievalScope } from './ragScope'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type { ChatMessage } from './llm/types'
import type { ChatTurn, DocChatSource, DocChatResult } from '../../../shared/types'
export type { ChatTurn } from '../../../shared/types'

// "Спроси документ" (TODO Feature I) — grounded Q&A over a course's uploaded
// reference materials (ГОСТы, методички, syllabi). The whole point is the
// grounded+cited framing: a generic chat would happily hallucinate a ГОСТ
// clause number, which is actively dangerous for a normative check. Two
// defenses, not one:
//   1. Deterministic refusal gate — if even the best-matching chunk is a
//      poor match (or the course has no material at all), we never call the
//      LLM; we return a fixed "not found in the materials" answer.
//   2. Prompt-level instruction — the system prompt forbids answering from
//      general knowledge and requires bracket citations [N] tied to the
//      retrieved excerpts, same citation-marker convention as
//      services/presentations.ts.

const MAX_SOURCES        = 5
const SOURCE_EXCERPT_LEN = 600
const MAX_HISTORY_TURNS  = 6     // most recent N turns resent for continuity
// Cosine distance (0 = identical, larger = less similar) above which the top
// match is treated as "nothing relevant" rather than trusted as grounding.
// Starting heuristic — revisit against real usage once this ships, same as
// citationChecker's reference cap and calcVerifier's tolerance.
const UNGROUNDED_DISTANCE = 0.35

const NOTHING_FOUND_ANSWER =
  'В загруженных материалах предмета нет информации по этому вопросу. ' +
  'Загрузите документ, который может содержать ответ, или уточните вопрос.'

function buildSystemPrompt(chunks: ScoredChunk[]): string {
  const lines: string[] = [
    'Ты отвечаешь на вопросы преподавателя строго на основе приведённых ниже фрагментов документов.',
    'Правила:',
    '- Отвечай ТОЛЬКО тем, что прямо следует из фрагментов ниже. Никогда не дополняй ответ из общих знаний.',
    '- Если ответа во фрагментах нет или он не полный — прямо скажи об этом, не додумывай.',
    '- При каждом утверждении, взятом из фрагмента, ставь маркер [N], где N — номер фрагмента.',
    '- Отвечай кратко и по делу, на русском языке.',
    '',
    '## Фрагменты документов',
  ]
  chunks.forEach((c, i) => {
    const meta: string[] = [c.file_name]
    if (c.page_start && c.page_end && c.page_start !== c.page_end) meta.push(`стр. ${c.page_start}–${c.page_end}`)
    else if (c.page_start) meta.push(`стр. ${c.page_start}`)
    lines.push(`[${i + 1}] ${meta.join(' · ')}`)
    lines.push(sanitiseForPrompt(c.text.slice(0, SOURCE_EXCERPT_LEN)))
    lines.push('')
  })
  return lines.join('\n')
}

/**
 * Strip [N] markers pointing at non-existent sources; report which indices
 * were actually cited. Exported for the unit test suite — the rest of
 * askDocument needs a live DB + LLM call to exercise.
 */
export function extractCitedIndices(text: string, validCount: number): { cleaned: string; cited: Set<number> } {
  const cited = new Set<number>()
  const cleaned = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, group: string) => {
    const nums = group
      .split(',')
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => n >= 1 && n <= validCount)
    nums.forEach((n: number) => cited.add(n))
    return nums.length ? `[${nums.join(', ')}]` : ''
  })
  return { cleaned, cited }
}

export async function askDocument(params: {
  teacherId:     string
  institutionId?: string
  courseId:      string
  question:      string
  history?:      ChatTurn[]
}): Promise<DocChatResult> {
  const question = sanitiseForPrompt(params.question)
  const context = { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' as const }

  const vector = await embed(question, context)
  const scope = await resolveRagRetrievalScope(params.courseId)
  const chunks = await findRelevantChunksScored(scope, vector, MAX_SOURCES)
  logDocumentRetrievals(chunks, scope.courseId, params.teacherId).catch(() => null)

  const bestMatch = chunks[0]
  if (!bestMatch || bestMatch.distance > UNGROUNDED_DISTANCE) {
    return { answer: NOTHING_FOUND_ANSWER, sources: [], grounded: false }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(chunks) },
    ...(params.history ?? []).slice(-MAX_HISTORY_TURNS).map((t) => ({
      role: t.role, content: sanitiseForPrompt(t.content),
    })),
    { role: 'user', content: question },
  ]

  const raw = await chat(messages, { context, temperature: 0.2, maxTokens: 1200 })
  const { cleaned, cited } = extractCitedIndices(raw, chunks.length)

  const sources: DocChatSource[] = chunks
    .map((c, i) => ({
      idx:         i + 1,
      document_id: c.document_id,
      file_name:   c.file_name,
      page_start:  c.page_start,
      page_end:    c.page_end,
      excerpt:     c.text.slice(0, SOURCE_EXCERPT_LEN),
    }))
    .filter((s) => cited.has(s.idx))

  return { answer: cleaned.trim(), sources, grounded: true }
}
