import { describe, it, expect } from 'vitest'
import { chunkDocument } from './chunker'

const DOC = 'doc-1'
const COURSE = 'course-1'

// Build a paginated test corpus: N pages of M paragraphs each, separated by \f.
function paginate(pages: string[][]): string {
  return pages
    .map((paragraphs) => paragraphs.join('\n\n'))
    .join('\f')
}

const longPara = (label: string) =>
  // ~600 chars so a few paragraphs overflow the TARGET_CHUNK_TOKENS * 3.5 bound (≈ 1750 chars)
  `${label}: ` + 'Текст об образовании, методах обучения и педагогической практике. '.repeat(8)

describe('chunkDocument — page tracking', () => {
  it('assigns null pages for an unpaginated (DOCX) document', () => {
    const text = [longPara('A'), longPara('B'), longPara('C')].join('\n\n')
    const chunks = chunkDocument(text, DOC, COURSE)
    expect(chunks.length).toBeGreaterThan(0)
    for (const c of chunks) {
      expect(c.pageStart).toBeNull()
      expect(c.pageEnd).toBeNull()
    }
  })

  it('starts at page 1 implicitly for paginated documents', () => {
    const text = paginate([[longPara('A')], [longPara('B')]])
    const chunks = chunkDocument(text, DOC, COURSE)
    expect(chunks[0].pageStart).toBe(1)
  })

  it('advances page numbers across form-feeds', () => {
    const text = paginate([
      [longPara('A')],
      [longPara('B')],
      [longPara('C')],
    ])
    const chunks = chunkDocument(text, DOC, COURSE)
    // Final chunk should reference the last page in the document
    const last = chunks[chunks.length - 1]
    expect(last.pageEnd).toBe(3)
  })

  it('covers every page across the resulting chunks', () => {
    // Each page has enough content to produce at least one chunk rooted there.
    // The chunker's overlap window can bleed content from a previous page into
    // the next chunk, so we don't assert page_start == page_end — instead we
    // verify each page label appears in the chunk set.
    const big = (n: number) => longPara(`P${n}`) + '\n\n' + longPara(`P${n}b`) + '\n\n' + longPara(`P${n}c`)
    const text = paginate([[big(1)], [big(2)], [big(3)]])
    const chunks = chunkDocument(text, DOC, COURSE)
    const seen = new Set<number>()
    chunks.forEach((c) => {
      for (let p = c.pageStart!; p <= c.pageEnd!; p++) seen.add(p)
    })
    expect(seen.has(1) && seen.has(2) && seen.has(3)).toBe(true)
  })

  it('spans page ranges when a chunk straddles pages', () => {
    // Tiny paragraphs (each > 30 chars to clear the chunker filter) packed
    // onto multiple pages — multiple paragraphs combine into one chunk.
    const small = (n: number) =>
      `Параграф номер ${n} с достаточным количеством слов для прохождения фильтра.`
    const text = paginate([
      [small(1), small(2)],
      [small(3), small(4)],
      [small(5), small(6)],
    ])
    const chunks = chunkDocument(text, DOC, COURSE)
    // The first chunk pulls content from at least two pages.
    expect(chunks[0].pageStart).toBe(1)
    expect(chunks[0].pageEnd).toBeGreaterThanOrEqual(2)
  })

  it('drops paragraphs shorter than the 30-char filter', () => {
    const text = ['x', longPara('A'), 'y'].join('\n\n')
    const chunks = chunkDocument(text, DOC, COURSE)
    // Only the long paragraph survives → exactly one chunk
    expect(chunks.length).toBe(1)
  })

  it('assigns increasing chunkIndex', () => {
    const text = Array.from({ length: 6 }, (_, i) => longPara(`P${i}`)).join('\n\n')
    const chunks = chunkDocument(text, DOC, COURSE)
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i))
  })

  it('detects schedule-type chunks via Russian keywords', () => {
    const text = `Расписание занятий по неделям. ${'Очень важный текст. '.repeat(40)}`
    const chunks = chunkDocument(text, DOC, COURSE)
    expect(chunks[0].chunkType).toBe('schedule')
  })

  it('detects reading-list chunks', () => {
    const text = `Список литературы и библиография. ${'Важный текст. '.repeat(40)}`
    const chunks = chunkDocument(text, DOC, COURSE)
    expect(chunks[0].chunkType).toBe('reading_list')
  })

  it('falls back to general for prosaic content', () => {
    const text = longPara('Обычное содержание лекции без ключевых слов рубрики')
    const chunks = chunkDocument(text, DOC, COURSE)
    expect(chunks[0].chunkType).toBe('general')
  })

  it('preserves all chunks with valid token estimates', () => {
    const text = Array.from({ length: 5 }, (_, i) => longPara(`P${i}`)).join('\n\n')
    const chunks = chunkDocument(text, DOC, COURSE)
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeGreaterThan(0)
      expect(c.documentId).toBe(DOC)
      expect(c.courseId).toBe(COURSE)
    }
  })
})
