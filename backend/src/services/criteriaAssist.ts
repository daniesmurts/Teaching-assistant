// AI-assisted rewrite of a teacher's rough criterion description into
// something that works better as grading-prompt input — concrete, scoped to
// "what's being assessed," no vague filler. The rewritten text still lands
// in the same unsanitised-at-source slot buildCriteriaPrompt() interpolates
// (see grading.ts), so it goes through sanitiseForPrompt() like every other
// piece of user text reaching a prompt (CLAUDE.md rule #1).
//
// One bounded LLM call, no DB writes — mirrors calcVerifier.ts/citationChecker.ts's
// shape. The teacher accepts or rejects the suggestion client-side; nothing
// is persisted here.

import { chatJSON } from './llm/registry'
import type { CallContext } from './llm/types'
import { sanitiseForPrompt } from '../lib/promptSanitiser'

const MAX_DESCRIPTION_CHARS = 500

interface ImproveResult {
  improved?: unknown
}

export async function improveCriterionDescription(params: {
  name:        string
  description: string
  context:     CallContext
}): Promise<string> {
  const system = `Ты помогаешь преподавателю сформулировать описание критерия оценивания так, ` +
    `чтобы оно было понятной инструкцией для ИИ-проверяющего: конкретно, без воды, без изменения ` +
    `сути того, что преподаватель хочет оценить. Не добавляй новых требований и не расширяй область ` +
    `критерия — только проясняй и уточняй уже сказанное. Отвечай JSON: {"improved": "..."}. ` +
    `Длина — не более ${MAX_DESCRIPTION_CHARS} символов.`

  const user = `Название критерия: ${sanitiseForPrompt(params.name)}\n` +
    `Текущее описание: ${sanitiseForPrompt(params.description)}`

  const result = await chatJSON<ImproveResult>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'улучшенное описание критерия',
    { context: params.context, temperature: 0.3 },
  )

  const improved = typeof result.improved === 'string' ? result.improved.trim() : ''
  return improved.slice(0, MAX_DESCRIPTION_CHARS)
}
