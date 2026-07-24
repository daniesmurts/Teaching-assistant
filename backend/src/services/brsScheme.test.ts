import { describe, it, expect, vi } from 'vitest'
import { extractBrsDraft, computeStudentAccrual, type AccrualScheme } from './brsScheme'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

const SOURCE_TEXT = `
8.1. Промежуточная аттестация проводится в форме зачёта с оценкой по
балльно-рейтинговой системе (БРС).

КТ-1 Контрольная работа — максимум 30 баллов.
КТ-2 Тест — максимум 20 баллов.
Посещение занятий — максимум 10 баллов.

Итоговая оценка: 61-75 баллов — удовлетворительно, 76-90 — хорошо,
91-100 — отлично.
`.trim()

describe('extractBrsDraft', () => {
  it('returns empty draft for text too short to be a real РПД', async () => {
    const draft = await extractBrsDraft('too short')
    expect(draft.checkpoints).toEqual([])
    expect(chatJSONMock).not.toHaveBeenCalled()
  })

  it('marks a checkpoint verified when its name is verbatim in the source', async () => {
    chatJSONMock.mockResolvedValueOnce({
      title: 'БРС по дисциплине',
      checkpoints: [{ name: 'КТ-1 Контрольная работа', max_points: 30 }],
      grade_thresholds: [],
    })

    const draft = await extractBrsDraft(SOURCE_TEXT)
    expect(draft.checkpoints).toHaveLength(1)
    expect(draft.checkpoints[0].is_verbatim_verified).toBe(true)
    expect(draft.checkpoints[0].max_points).toBe(30)
    expect(draft.checkpoints[0].checkpoint_type).toBe('graded')
  })

  it('marks a paraphrased (non-verbatim) checkpoint as unverified, not dropped', async () => {
    chatJSONMock.mockResolvedValueOnce({
      title: null,
      checkpoints: [{ name: 'Контрольная работа №1', max_points: 30 }],
      grade_thresholds: [],
    })

    const draft = await extractBrsDraft(SOURCE_TEXT)
    expect(draft.checkpoints).toHaveLength(1)
    expect(draft.checkpoints[0].is_verbatim_verified).toBe(false)
  })

  it('hints checkpoint_type as manual for attendance/participation-style names', async () => {
    chatJSONMock.mockResolvedValueOnce({
      title: null,
      checkpoints: [{ name: 'Посещение занятий', max_points: 10 }],
      grade_thresholds: [],
    })

    const draft = await extractBrsDraft(SOURCE_TEXT)
    expect(draft.checkpoints[0].checkpoint_type).toBe('manual')
  })

  it('drops a checkpoint row missing a required field (name/max_points)', async () => {
    chatJSONMock.mockResolvedValueOnce({
      title: null,
      checkpoints: [
        { name: 'КТ-1 Контрольная работа' }, // missing max_points
        { name: 'КТ-2 Тест', max_points: 20 },
      ],
      grade_thresholds: [],
    })

    const draft = await extractBrsDraft(SOURCE_TEXT)
    expect(draft.checkpoints).toHaveLength(1)
    expect(draft.checkpoints[0].name).toBe('КТ-2 Тест')
  })

  it('propagates a chatJSON error rather than silently returning an empty draft (see fgosExtractor.test.ts for the production incident that motivated this)', async () => {
    chatJSONMock.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(extractBrsDraft(SOURCE_TEXT)).rejects.toThrow('provider unavailable')
  })

  it('passes through grade thresholds', async () => {
    chatJSONMock.mockResolvedValueOnce({
      title: null,
      checkpoints: [],
      grade_thresholds: [
        { min_points: 61, max_points: 75, grade_label: 'удовлетворительно' },
        { min_points: 76, max_points: 90, grade_label: 'хорошо' },
        { min_points: 91, max_points: 100, grade_label: 'отлично' },
      ],
    })

    const draft = await extractBrsDraft(SOURCE_TEXT)
    expect(draft.gradeThresholds).toEqual([
      { min_points: 61, max_points: 75, grade_label: 'удовлетворительно' },
      { min_points: 76, max_points: 90, grade_label: 'хорошо' },
      { min_points: 91, max_points: 100, grade_label: 'отлично' },
    ])
  })
})

describe('computeStudentAccrual', () => {
  const scheme: AccrualScheme = {
    checkpoints: [
      { id: 'cp1', name: 'КТ-1', max_points: 20, checkpoint_type: 'graded', is_verbatim_verified: true },
      { id: 'cp2', name: 'Посещение', max_points: 10, checkpoint_type: 'manual', is_verbatim_verified: true },
    ],
    gradeThresholds: [
      { min_points: 16, max_points: 20, grade_label: 'удовлетворительно' },
      { min_points: 21, max_points: 25, grade_label: 'хорошо' },
      { min_points: 26, max_points: 30, grade_label: 'отлично' },
    ],
  }

  it('rescales a 0-100 approved score onto the checkpoint max_points', () => {
    const result = computeStudentAccrual(scheme, [{ brs_checkpoint_id: 'cp1', approved_score: 80 }], [])
    const cp1 = result.checkpoints.find((c) => c.checkpoint_id === 'cp1')!
    expect(cp1.earned_points).toBe(16) // 80/100 * 20
    expect(cp1.raw_points).toBe(16)
  })

  it('sums multiple scored rows on the same checkpoint and caps at max_points', () => {
    const result = computeStudentAccrual(
      scheme,
      [
        { brs_checkpoint_id: 'cp1', approved_score: 80 }, // 16
        { brs_checkpoint_id: 'cp1', approved_score: 60 }, // 12
      ],
      [],
    )
    const cp1 = result.checkpoints.find((c) => c.checkpoint_id === 'cp1')!
    expect(cp1.raw_points).toBe(28)
    expect(cp1.earned_points).toBe(20) // capped at max_points
  })

  it('sums manual entries for manual-type checkpoints', () => {
    const result = computeStudentAccrual(scheme, [], [
      { brs_checkpoint_id: 'cp2', points: 5 },
      { brs_checkpoint_id: 'cp2', points: 3 },
    ])
    const cp2 = result.checkpoints.find((c) => c.checkpoint_id === 'cp2')!
    expect(cp2.earned_points).toBe(8)
  })

  it('returns null earned_points (not 0) for a checkpoint with no rows at all', () => {
    const result = computeStudentAccrual(scheme, [], [])
    expect(result.checkpoints.every((c) => c.earned_points === null)).toBe(true)
    expect(result.total_points).toBe(0)
  })

  it('resolves final_grade_label from thresholds', () => {
    const good = computeStudentAccrual(scheme, [{ brs_checkpoint_id: 'cp1', approved_score: 100 }], [{ brs_checkpoint_id: 'cp2', points: 5 }])
    // total = 20 + 5 = 25 -> "хорошо"
    expect(good.total_points).toBe(25)
    expect(good.final_grade_label).toBe('хорошо')
  })

  it('returns null final_grade_label when total is below every threshold minimum', () => {
    const low = computeStudentAccrual(scheme, [{ brs_checkpoint_id: 'cp1', approved_score: 10 }], [])
    expect(low.final_grade_label).toBeNull()
  })

  it('returns the top threshold label when total exceeds every threshold max', () => {
    const overflowScheme: AccrualScheme = {
      checkpoints: [{ id: 'cp1', name: 'КТ-1', max_points: 40, checkpoint_type: 'graded', is_verbatim_verified: true }],
      gradeThresholds: scheme.gradeThresholds,
    }
    const result = computeStudentAccrual(overflowScheme, [{ brs_checkpoint_id: 'cp1', approved_score: 100 }], [])
    expect(result.total_points).toBe(40)
    expect(result.final_grade_label).toBe('отлично')
  })
})
