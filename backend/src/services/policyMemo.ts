// Distils recurring teacher corrections into a short per-course memo.
//
// RAG examples show the model WHAT past work looked like; this memo tells it
// HOW this specific teacher tends to grade differently from the raw AI draft
// — patterns like "снижает за оформление строже ИИ" that a handful of
// few-shot examples don't reliably convey. Injected into every grading
// prompt for the course alongside buildExamplesBlock().

import { chatJSON } from './deepseek'
import { getActiveProviderName } from './llm/registry'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import {
  findPolicyMemoSources,
  countApprovalsSince,
  getPolicyMemo,
  upsertPolicyMemo,
} from '../db/queries/policyMemos'
import { logger } from '../lib/logger'

const MIN_SOURCES = 5
const REGENERATE_EVERY = 10

/**
 * Regenerate the course's policy memo if enough new corrections have
 * accumulated since the last generation (or none exists yet). Safe to call
 * after every approval — the count check makes it a cheap no-op most of the
 * time. Never throws; failures are logged and swallowed (fire-and-forget
 * caller expected).
 */
export async function maybeRegeneratePolicyMemo(courseId: string, teacherId: string): Promise<void> {
  try {
    const existing = await getPolicyMemo(courseId)
    const since = existing ? new Date(existing.generated_at) : null
    const newApprovals = await countApprovalsSince(courseId, since)
    if (existing && newApprovals < REGENERATE_EVERY) return
    await generatePolicyMemo(courseId, teacherId)
  } catch (err) {
    logger.warn({ message: '[PolicyMemo] Auto-regeneration failed', courseId, error: (err as Error).message })
  }
}

export async function generatePolicyMemo(courseId: string, teacherId: string): Promise<void> {
  const sources = await findPolicyMemoSources(courseId, 30)
  if (sources.length < MIN_SOURCES) return

  const items = sources
    .map((s, i) => {
      const excerpt = sanitiseForPrompt(s.submission_excerpt)
      return `### Работа ${i + 1} (фрагмент)\n${excerpt}\n` +
        `ИИ: ${s.ai_score ?? '—'} баллов. «${sanitiseForPrompt(s.ai_feedback ?? '')}»\n` +
        `Преподаватель: ${s.approved_score ?? '—'} баллов. «${sanitiseForPrompt(s.approved_feedback ?? '')}»`
    })
    .join('\n\n---\n\n')

  const system = `Вы анализируете расхождения между черновой оценкой ИИ и финальной оценкой преподавателя по одному предмету. ` +
    `Ваша задача — выявить ПОВТОРЯЮЩИЕСЯ закономерности в том, как преподаватель систематически отличается от ИИ ` +
    `(строже/мягче по каким темам, что считает существенным недостатком, что не засчитывает и т.д.). ` +
    `Игнорируйте единичные случаи — только паттерны, видные минимум в 2-3 примерах. ` +
    `Если явных закономерностей нет, верните короткий memo_text об этом. Отвечайте только валидным JSON.`

  const user = `## Пары «оценка ИИ» → «оценка преподавателя»\n\n${items}\n\n` +
    `Верните JSON: {"memo_text": краткая памятка на русском (3-5 предложений) для будущих грейдингов по этому предмету, ` +
    `описывающая, как калибровать оценку ИИ под предпочтения этого преподавателя}.`

  const context = { teacherId, feature: 'grading' as const }
  const result = await chatJSON<{ memo_text: string }>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'профиль оценивания',
    { context },
  )

  const memoText = String(result.memo_text ?? '').trim()
  if (!memoText) return

  const provider = await getActiveProviderName(context, {})
  await upsertPolicyMemo(courseId, memoText.slice(0, 2000), sources.length, provider)
}
