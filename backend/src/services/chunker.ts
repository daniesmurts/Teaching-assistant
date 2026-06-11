export type ChunkType = 'overview' | 'schedule' | 'assessment' | 'reading_list' | 'general'

export interface DocumentChunk {
  documentId:    string
  courseId:      string
  chunkIndex:    number
  chunkType:     ChunkType
  text:          string
  tokenEstimate: number
  pageStart:     number | null
  pageEnd:       number | null
}

const TARGET_CHUNK_TOKENS = 500
const OVERLAP_TOKENS      = 50
const CHARS_PER_TOKEN     = 3.5

/**
 * Split a knowledge document into overlapping, paragraph-aligned chunks.
 *
 * The extractor preserves form-feed (\f) page breaks for paginated formats
 * (PDF text-layer, OCR), so we can derive page_start / page_end per chunk by
 * counting the form-feeds the chunk's paragraphs span. For DOCX (no native
 * pages) pageStart/pageEnd remain null.
 *
 * Each chunk is later embedded and stored for RAG retrieval — never sent to
 * DeepSeek wholesale.
 */
export function chunkDocument(
  text: string,
  documentId: string,
  courseId: string
): DocumentChunk[] {
  const targetChars  = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN
  const overlapChars = OVERLAP_TOKENS      * CHARS_PER_TOKEN

  // Walk paragraph-by-paragraph but also track which page each paragraph
  // starts on, by counting form-feeds in the cumulative source text. Page 1
  // is implicit (no form-feed before the first byte).
  const paragraphs: Array<{ text: string; page: number }> = []
  const splits = text.split(/(\n\s*\n)/)   // keep separators so we don't lose page boundaries
  let cursorPage = 1
  for (const segment of splits) {
    if (/^\n\s*\n$/.test(segment)) continue                      // pure separator
    const formFeeds = (segment.match(/\f/g) ?? []).length
    if (segment.trim().length > 30) {
      paragraphs.push({ text: segment.replace(/\f/g, '').trim(), page: cursorPage })
    }
    cursorPage += formFeeds
  }
  // If there were no form-feeds at all, this is an unpaginated document — keep
  // page info null on every chunk rather than printing a misleading "стр. 1".
  const paginated = text.includes('\f')

  const chunks: DocumentChunk[] = []
  let current     = ''
  let chunkStart  = paragraphs[0]?.page ?? 1
  let chunkEnd    = chunkStart
  let chunkIndex  = 0

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para.text}` : para.text

    if (candidate.length > targetChars && current.length > 0) {
      chunks.push(makeChunk(current, documentId, courseId, chunkIndex++, paginated ? chunkStart : null, paginated ? chunkEnd : null))
      const overlap = current.slice(-overlapChars)
      current     = `${overlap}\n\n${para.text}`
      chunkStart  = para.page
      chunkEnd    = para.page
    } else {
      current  = candidate
      chunkEnd = para.page
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(current, documentId, courseId, chunkIndex, paginated ? chunkStart : null, paginated ? chunkEnd : null))
  }

  return chunks
}

function makeChunk(
  text: string,
  documentId: string,
  courseId: string,
  chunkIndex: number,
  pageStart: number | null,
  pageEnd:   number | null
): DocumentChunk {
  return {
    documentId,
    courseId,
    chunkIndex,
    chunkType:     detectChunkType(text),
    text:          text.trim(),
    tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
    pageStart,
    pageEnd,
  }
}

function detectChunkType(text: string): ChunkType {
  const t = text.toLowerCase()
  if (t.includes('расписание') || t.includes('schedule') || t.includes('неделя') || t.includes('week'))
    return 'schedule'
  if (t.includes('оценивание') || t.includes('assessment') || t.includes('экзамен') || t.includes('exam'))
    return 'assessment'
  if (t.includes('литература') || t.includes('reading') || t.includes('библиография'))
    return 'reading_list'
  if (t.includes('цели') || t.includes('objectives') || t.includes('описание курса') || t.includes('описание предмета') || t.includes('описание дисциплины'))
    return 'overview'
  return 'general'
}
