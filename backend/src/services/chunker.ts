export type ChunkType = 'overview' | 'schedule' | 'assessment' | 'reading_list' | 'general'

export interface DocumentChunk {
  documentId:    string
  courseId:      string
  chunkIndex:    number
  chunkType:     ChunkType
  text:          string
  tokenEstimate: number
}

const TARGET_CHUNK_TOKENS = 500
const OVERLAP_TOKENS      = 50
const CHARS_PER_TOKEN     = 3.5

/**
 * Split a knowledge document into overlapping, paragraph-aligned chunks.
 * Each chunk is later embedded and stored for RAG retrieval — never sent
 * to DeepSeek wholesale.
 */
export function chunkDocument(
  text: string,
  documentId: string,
  courseId: string
): DocumentChunk[] {
  const targetChars  = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN
  const overlapChars = OVERLAP_TOKENS      * CHARS_PER_TOKEN

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30)

  const chunks: DocumentChunk[] = []
  let current = ''
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph

    if (candidate.length > targetChars && current.length > 0) {
      chunks.push(makeChunk(current, documentId, courseId, chunkIndex++))
      const overlap = current.slice(-overlapChars)
      current = `${overlap}\n\n${paragraph}`
    } else {
      current = candidate
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(current, documentId, courseId, chunkIndex))
  }

  return chunks
}

function makeChunk(
  text: string,
  documentId: string,
  courseId: string,
  chunkIndex: number
): DocumentChunk {
  return {
    documentId,
    courseId,
    chunkIndex,
    chunkType:     detectChunkType(text),
    text:          text.trim(),
    tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
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
