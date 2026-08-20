import { describe, it, expect, vi, beforeEach } from 'vitest'

const { chatJSONMock, embedMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn(), embedMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock, embed: embedMock }))

import { analyzeCurriculumOverlap, type OverlapItem } from './curriculumAnalysis'

// analyzeCurriculumOverlap used to resolve `courseIds` itself via
// findCourseById(teacherId) — only a course's owner could ever run it. It now
// takes already-resolved {id, name, content} items, so routes/curriculum.ts
// can source them from a teacher's own courses OR (TODO Feature AM) a
// программа a методист has read access to. These tests pin the decoupled
// contract: the service no longer cares where an item came from.

function topicsFor(title: string) {
  return { topics: [{ title, summary: `про ${title}` }] }
}

describe('analyzeCurriculumOverlap', () => {
  beforeEach(() => {
    chatJSONMock.mockReset()
    embedMock.mockReset()
    embedMock.mockResolvedValue([1, 0, 0])
  })

  it('rejects fewer than two items regardless of source', async () => {
    const items: OverlapItem[] = [{ id: 'a', name: 'Матанализ', content: 'x'.repeat(200) }]
    await expect(analyzeCurriculumOverlap({ teacherId: 't1', items })).rejects.toThrow(/минимум две/)
  })

  it('de-dupes items by id before requiring the minimum of two', async () => {
    const items: OverlapItem[] = [
      { id: 'a', name: 'Матанализ', content: 'x'.repeat(200) },
      { id: 'a', name: 'Матанализ', content: 'x'.repeat(200) },
    ]
    await expect(analyzeCurriculumOverlap({ teacherId: 't1', items })).rejects.toThrow(/минимум две/)
  })

  it('skips items with too little content instead of failing the whole batch', async () => {
    chatJSONMock.mockResolvedValue(topicsFor('Тема'))
    const items: OverlapItem[] = [
      { id: 'a', name: 'Матанализ', content: 'x'.repeat(200) },
      { id: 'b', name: 'Физика', content: 'y'.repeat(200) },
      { id: 'c', name: 'Химия', content: 'слишком коротко' },
    ]
    const result = await analyzeCurriculumOverlap({ teacherId: 't1', items })
    expect(result.skipped).toEqual([
      { course_id: 'c', course_name: 'Химия', reason: expect.stringContaining('Нет содержания') },
    ])
  })

  it('carries preSkipped items (programme-path not-found/no-document) straight into the result', async () => {
    chatJSONMock.mockResolvedValue(topicsFor('Тема'))
    const items: OverlapItem[] = [
      { id: 'a', name: 'Матанализ', content: 'x'.repeat(200) },
      { id: 'b', name: 'Физика', content: 'x'.repeat(200) },
    ]
    const result = await analyzeCurriculumOverlap({
      teacherId: 't1', items,
      preSkipped: [{ course_id: 'ghost', course_name: '—', reason: 'Дисциплина не найдена' }],
    })
    expect(result.skipped).toContainEqual({ course_id: 'ghost', course_name: '—', reason: 'Дисциплина не найдена' })
  })

  it('analyses items regardless of whether their id is a course or a programme discipline', async () => {
    chatJSONMock.mockResolvedValue(topicsFor('Общая тема'))
    const items: OverlapItem[] = [
      { id: 'disc-1', name: 'Матанализ', content: 'x'.repeat(200) },
      { id: 'disc-2', name: 'Физика', content: 'y'.repeat(200) },
    ]
    const result = await analyzeCurriculumOverlap({ teacherId: 't1', items })
    expect(result.analyzed.map((a) => a.course_id)).toEqual(['disc-1', 'disc-2'])
    expect(result.skipped).toEqual([])
  })
})
