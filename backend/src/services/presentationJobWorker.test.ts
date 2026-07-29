import { describe, it, expect, vi, beforeEach } from 'vitest'
import type PgBoss from 'pg-boss'
import { registerPresentationJobWorker, PRESENTATION_JOB_QUEUE, type PresentationJobPayload } from './presentationJobWorker'

vi.mock('./presentations', () => ({ generatePresentation: vi.fn() }))
vi.mock('../db/queries/presentationJobs', () => ({
  getPresentationJobByIdUnscoped: vi.fn(),
  setPresentationJobProcessing:   vi.fn(),
  completePresentationJob:        vi.fn(),
  failPresentationJob:            vi.fn(),
}))
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { generatePresentation } from './presentations'
import {
  getPresentationJobByIdUnscoped, setPresentationJobProcessing, completePresentationJob, failPresentationJob,
} from '../db/queries/presentationJobs'

const PARAMS = { teacherId: 't1', topic: 'x', durationMinutes: 60, learningGoals: [] } as PresentationJobPayload['params']

// Captures every worker callback pg-boss would invoke (one per registered
// boss.work() call — registerPresentationJobWorker registers several for
// concurrency), so tests can call any of them directly with a synthetic job.
async function captureHandlers() {
  const handlers: Array<(jobs: Array<{ data: PresentationJobPayload; retryCount: number; retryLimit: number }>) => Promise<void>> = []
  const boss = {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work:        vi.fn().mockImplementation(async (_q: string, _o: unknown, cb: typeof handlers[number]) => { handlers.push(cb) }),
  } as unknown as PgBoss
  await registerPresentationJobWorker(boss)
  expect(boss.createQueue).toHaveBeenCalledWith(PRESENTATION_JOB_QUEUE, expect.objectContaining({ name: PRESENTATION_JOB_QUEUE }))
  expect(handlers.length).toBeGreaterThan(1)   // concurrency via multiple registrations, not batchSize
  return handlers[0]
}

const job = (retryCount = 0, retryLimit = 1) =>
  [{ data: { jobId: 'job1', params: PARAMS }, retryCount, retryLimit }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPresentationJobByIdUnscoped).mockResolvedValue({ id: 'job1', status: 'pending' } as never)
  vi.mocked(failPresentationJob).mockResolvedValue(undefined)
})

describe('presentationJobWorker', () => {
  it('generates and completes the job row on success', async () => {
    const result = { presentation_id: 'p1', slides: [], generated_content: '', sources: [] }
    vi.mocked(generatePresentation).mockResolvedValue(result as never)

    await (await captureHandlers())(job())

    expect(setPresentationJobProcessing).toHaveBeenCalledWith('job1')
    expect(generatePresentation).toHaveBeenCalledWith(PARAMS)
    expect(completePresentationJob).toHaveBeenCalledWith('job1', result)
    expect(failPresentationJob).not.toHaveBeenCalled()
  })

  it('skips generation when a previous attempt already completed the row', async () => {
    vi.mocked(getPresentationJobByIdUnscoped).mockResolvedValue({ id: 'job1', status: 'ready' } as never)

    await (await captureHandlers())(job(1, 1))

    expect(generatePresentation).not.toHaveBeenCalled()
    expect(completePresentationJob).not.toHaveBeenCalled()
  })

  it('rethrows on failure without marking the row failed when retries remain', async () => {
    vi.mocked(generatePresentation).mockRejectedValue(new Error('provider blip'))

    await expect((await captureHandlers())(job(0, 1))).rejects.toThrow('provider blip')
    expect(failPresentationJob).not.toHaveBeenCalled()
  })

  it('marks the row failed on the last attempt', async () => {
    vi.mocked(generatePresentation).mockRejectedValue(new Error('provider down'))

    await expect((await captureHandlers())(job(1, 1))).rejects.toThrow('provider down')
    expect(failPresentationJob).toHaveBeenCalledWith('job1', 'provider down')
  })
})
