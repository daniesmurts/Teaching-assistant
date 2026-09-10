import client from './client'

export type SatisfactionFeature = 'grading' | 'presentation'

/** 1 = плохо, 2 = нормально, 3 = хорошо. */
export type SatisfactionScore = 1 | 2 | 3

/** Asks the server whether to prompt — and, when the answer is yes, books the
 *  prompt server-side. Never throws: a satisfaction survey must never be able
 *  to surface an error on top of the action the teacher actually took. */
export async function checkSatisfactionPrompt(
  feature: SatisfactionFeature,
  artifactId?: string,
  context?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data } = await client.post('/api/satisfaction/check', { feature, artifactId, context })
    return data.prompt ? (data.promptId as string) : null
  } catch {
    return null
  }
}

export async function answerSatisfaction(promptId: string, score: SatisfactionScore): Promise<void> {
  await client.post(`/api/satisfaction/${promptId}/answer`, { score })
}

export async function commentSatisfaction(promptId: string, comment: string): Promise<void> {
  await client.post(`/api/satisfaction/${promptId}/comment`, { comment })
}

export async function dismissSatisfaction(promptId: string): Promise<void> {
  try {
    await client.post(`/api/satisfaction/${promptId}/dismiss`)
  } catch { /* a dismissal that fails must stay silent */ }
}
