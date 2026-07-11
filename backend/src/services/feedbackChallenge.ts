import { chatJSON } from './llm/registry'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { validateQuoteAgainstSource } from '../lib/citation'
import type { ChallengeRequest, ChallengeResult, ChallengeVerdict, ChallengeSourceType } from '../../../shared/types'

// "Оспорить" — a teacher who thinks a piece of AI feedback is wrong asks the
// model to re-verify it, rather than just editing the bullet by hand and the
// AI never learning why. Two defenses against the model just caving to
// pushback (sycophancy is a real failure mode once the teacher's objection is
// in the prompt):
//   1. The model must ground any non-'confirm' verdict in a fresh verbatim
//      quote from the SAME source text the original claim was checked
//      against — re-verification, not negotiation.
//   2. That quote is validated server-side exactly like grading citations
//      are (lib/citation.ts). A verdict the model can't back with a real
//      quote is downgraded to 'clarify' rather than trusted outright.

const MAX_SOURCE_TEXT_LEN = 20_000
const MAX_CLAIM_LEN       = 2000
const MAX_OBJECTION_LEN   = 1200

const SOURCE_LABEL: Record<ChallengeSourceType, string> = {
  grading_bullet:    'пункт списка (сильная сторона/недочёт) в отзыве о работе студента',
  grading_criterion: 'комментарий по критерию оценивания работы студента',
  grading_question:  'уточняющий вопрос к студенту по работе',
  syllabus_coverage: 'вывод о покрытии требования ФГОС в РПД (рабочей программе дисциплины)',
}

function buildSystemPrompt(sourceType: ChallengeSourceType): string {
  return [
    `Ты перепроверяешь свой собственный вывод — ${SOURCE_LABEL[sourceType]} — по просьбе преподавателя, ` +
      'который считает, что вывод ошибочен, преувеличен или не соответствует источнику.',
    '',
    'Тебе даны: исходный текст (единственный источник истины), исходное утверждение и возражение преподавателя.',
    '',
    'Правила:',
    '- Проверяй утверждение ТОЛЬКО по приведённому исходному тексту. Не используй общие знания и не додумывай.',
    '- Если преподаватель прав и утверждение не подтверждается текстом — отзови его (retract).',
    '- Если утверждение верно по сути, но сформулировано вводящим в заблуждение образом — уточни (clarify) ' +
      'и предложи более точную формулировку.',
    '- Если утверждение верно и подтверждается текстом — подтверди его (confirm), не поддавайся на возражение ' +
      'просто потому, что преподаватель не согласен.',
    '- Для confirm и clarify обязательно приведи evidence_quote — точную (дословную) цитату из исходного текста, ' +
      'которая подтверждает твой вердикт. Если не можешь найти дословную цитату — не подтверждай, выбери clarify или retract.',
    '- Для retract evidence_quote можно оставить null, если в тексте буквально ничего не подтверждает исходное утверждение.',
    '- explanation — 1-2 предложения преподавателю, почему ты пришёл к такому выводу.',
    '- suggested_text — при clarify или retract короткая переформулированная версия утверждения ' +
      '(или null при retract, если утверждение нужно просто убрать).',
    '',
    'Ответь строго в формате JSON:',
    '{"verdict": "confirm"|"clarify"|"retract", "explanation": "...", "evidence_quote": "..."|null, "suggested_text": "..."|null}',
  ].join('\n')
}

function buildUserPrompt(params: ChallengeRequest): string {
  const lines = [
    '## Исходный текст',
    sanitiseForPrompt(params.source_text.slice(0, MAX_SOURCE_TEXT_LEN)),
    '',
    '## Исходное утверждение (то, что нужно перепроверить)',
    sanitiseForPrompt(params.claim_text.slice(0, MAX_CLAIM_LEN)),
  ]
  if (params.claim_quote) {
    lines.push('', '## Цитата, на которую изначально опиралось утверждение', sanitiseForPrompt(params.claim_quote))
  }
  lines.push('', '## Возражение преподавателя', sanitiseForPrompt(params.objection.slice(0, MAX_OBJECTION_LEN)))
  return lines.join('\n')
}

interface RawVerdict {
  verdict?:        string
  explanation?:    string
  evidence_quote?: string | null
  suggested_text?: string | null
}

const VALID_VERDICTS: ChallengeVerdict[] = ['confirm', 'clarify', 'retract']

export async function challengeFeedback(
  params: ChallengeRequest & { teacherId: string; institutionId?: string },
): Promise<ChallengeResult> {
  const context = { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' as const }

  const raw = await chatJSON<RawVerdict>(
    [
      { role: 'system', content: buildSystemPrompt(params.source_type) },
      { role: 'user',   content: buildUserPrompt(params) },
    ],
    'вердикт по оспариванию',
    { context, temperature: 0 },
  )

  let verdict: ChallengeVerdict = VALID_VERDICTS.includes(raw.verdict as ChallengeVerdict)
    ? (raw.verdict as ChallengeVerdict)
    : 'clarify'

  const evidenceQuote = validateQuoteAgainstSource(raw.evidence_quote, params.source_text)

  // A 'confirm'/'clarify' verdict without a quote that actually appears in
  // the source text is an unverified claim, not a re-verification — treat it
  // the same way grading.ts drops a hallucinated citation.
  if (verdict !== 'retract' && !evidenceQuote) {
    verdict = 'clarify'
  }

  const explanation = typeof raw.explanation === 'string' && raw.explanation.trim()
    ? raw.explanation.trim().slice(0, 500)
    : 'Не удалось сформулировать объяснение.'

  const suggestedText = verdict !== 'confirm' && typeof raw.suggested_text === 'string' && raw.suggested_text.trim()
    ? raw.suggested_text.trim().slice(0, MAX_CLAIM_LEN)
    : null

  return { verdict, explanation, evidence_quote: evidenceQuote, suggested_text: suggestedText }
}
