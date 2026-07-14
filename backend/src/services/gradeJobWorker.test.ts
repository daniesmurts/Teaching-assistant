import { describe, it, expect, vi, beforeEach } from 'vitest'
import type PgBoss from 'pg-boss'
import { registerGradeJobWorker, GRADE_JOB_QUEUE, type GradeJobPayload } from './gradeJobWorker'

vi.mock('./grading', () => ({ grade: vi.fn() }))
vi.mock('../db/queries/gradeJobs', () => ({
  getGradeJobByIdUnscoped: vi.fn(),
  setGradeJobProcessing:   vi.fn(),
  completeGradeJob:        vi.fn(),
  failGradeJob:            vi.fn(),
}))
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { grade } from './grading'
import {
  getGradeJobByIdUnscoped, setGradeJobProcessing, completeGradeJob, failGradeJob,
} from '../db/queries/gradeJobs'

const PARAMS = { teacherId: 't1', planTier: 'pro', submissionText: 'x' } as GradeJobPayload['params']

// Captures the worker callback pg-boss would invoke, so tests can call it
// directly with a synthetic job.
async function captureHandler() {
  let handler: (jobs: Array<{ data: GradeJobPayload; retryCount: number; retryLimit: number }>) => Promise<void>
  const boss = {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work:        vi.fn().mockImplementation(async (_q: string, _o: unknown, cb: typeof handler) => { handler = cb }),
  } as unknown as PgBoss
  await registerGradeJobWorker(boss)
  expect(boss.createQueue).toHaveBeenCalledWith(GRADE_JOB_QUEUE, expect.objectContaining({ name: GRADE_JOB_QUEUE }))
  return handler!
}

const job = (retryCount = 0, retryLimit = 1) =>
  [{ data: { jobId: 'job1', params: PARAMS }, retryCount, retryLimit }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getGradeJobByIdUnscoped).mockResolvedValue({ id: 'job1', status: 'pending' } as never)
  vi.mocked(failGradeJob).mockResolvedValue(undefined)
})

describe('gradeJobWorker', () => {
  it('grades and completes the job row on success', async () => {
    const result = { assignment_id: 'a1', ai_score: 80 }
    vi.mocked(grade).mockResolvedValue(result as never)

    await (await captureHandler())(job())

    expect(setGradeJobProcessing).toHaveBeenCalledWith('job1')
    expect(grade).toHaveBeenCalledWith(PARAMS)
    expect(completeGradeJob).toHaveBeenCalledWith('job1', result, 'a1')
    expect(failGradeJob).not.toHaveBeenCalled()
  })

  it('skips grading when a previous attempt already completed the row', async () => {
    vi.mocked(getGradeJobByIdUnscoped).mockResolvedValue({ id: 'job1', status: 'ready' } as never)

    await (await captureHandler())(job(1, 1))

    expect(grade).not.toHaveBeenCalled()
    expect(completeGradeJob).not.toHaveBeenCalled()
  })

  it('rethrows on failure without marking the row failed when retries remain', async () => {
    vi.mocked(grade).mockRejectedValue(new Error('provider blip'))

    await expect((await captureHandler())(job(0, 1))).rejects.toThrow('provider blip')
    expect(failGradeJob).not.toHaveBeenCalled()
  })

  it('marks the row failed on the last attempt', async () => {
    vi.mocked(grade).mockRejectedValue(new Error('provider down'))

    await expect((await captureHandler())(job(1, 1))).rejects.toThrow('provider down')
    expect(failGradeJob).toHaveBeenCalledWith('job1', 'provider down')
  })
})
