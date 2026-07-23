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

// A chunk before it's stamped with the (documentId, courseId) it belongs to
// — what splitTextIntoChunks() actually produces. chunkDocument() (below)
// stamps course-document IDs onto this for the RAG path documents.ts uses;
// services/institutionStrategyDoc.ts (Feature Z Plane-2) stamps its own
// institution-document ID instead, reusing the same splitting logic without
// pretending a strategy document belongs to a course.
export type TextChunk = Omit<DocumentChunk, 'documentId' | 'courseId'>

const TARGET_CHUNK_TOKENS = 500
const OVERLAP_TOKENS      = 50
const CHARS_PER_TOKEN     = 3.5

/**
 * Split arbitrary text into overlapping, paragraph-aligned chunks.
 *
 * The extractor preserves form-feed (\f) page breaks for paginated formats
 * (PDF text-layer, OCR), so we can derive page_start / page_end per chunk by
 * counting the form-feeds the chunk's paragraphs span. For DOCX (no native
 * pages) pageStart/pageEnd remain null.
 *
 * Pure — no document/course identity. Each chunk is later embedded and
 * stored for RAG retrieval — never sent to DeepSeek wholesale.
 */
export function splitTextIntoChunks(text: string): TextChunk[] {
  const targetChars  = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN
  const overlapChars = OVERLAP_TOKENS      * CHARS_PER_TOKEN

  // Page is implicit at 1; each subsequent \f increments it. Splitting on \f
  // first then on paragraph boundaries within each page is simpler and more
  // correct than tracking a cursor while walking the joined string — and it
  // handles the edge case of "single paragraph that straddles a form-feed"
  // by treating the form-feed itself as a paragraph break.
  const paragraphs: Array<{ text: string; page: number }> = []
  const paginated = text.includes('\f')
  const pages     = text.split('\f')
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1
    const paragraphsOnPage = pages[i]
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 30)
    for (const p of paragraphsOnPage) {
      paragraphs.push({ text: p, page: pageNumber })
    }
  }

  const chunks: TextChunk[] = []
  let current     = ''
  let chunkStart  = paragraphs[0]?.page ?? 1
  let chunkEnd    = chunkStart
  let chunkIndex  = 0

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para.text}` : para.text

    if (candidate.length > targetChars && current.length > 0) {
      chunks.push(makeChunk(current, chunkIndex++, paginated ? chunkStart : null, paginated ? chunkEnd : null))
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
    chunks.push(makeChunk(current, chunkIndex, paginated ? chunkStart : null, paginated ? chunkEnd : null))
  }

  return chunks
}

/**
 * Course-document convenience wrapper around splitTextIntoChunks() — stamps
 * (documentId, courseId) onto each chunk for documents.ts's RAG path.
 */
export function chunkDocument(
  text: string,
  documentId: string,
  courseId: string
): DocumentChunk[] {
  return splitTextIntoChunks(text).map((c) => ({ ...c, documentId, courseId }))
}

function makeChunk(
  text: string,
  chunkIndex: number,
  pageStart: number | null,
  pageEnd:   number | null
): TextChunk {
  return {
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
