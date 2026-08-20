import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { validateQuoteAgainstSource } from '../lib/citation'

// Профстандарт/ОТФ registry (migration 115, методист feedback item 3) — one
// structured extraction pass over a профессиональный стандарт document's
// text. Mirrors services/fgosExtractor.ts exactly (never writes to the DB —
// routes/adminProfstandards.ts owns that, only after the admin confirms the
// review screen — rule #3; every ОТФ name is verbatim-checked against the
// source text — rule #2).

// профстандарты run shorter than a ФГОС (typically 5-15 pages of ОТФ/ТФ
// tables) but the same headroom logic applies — see fgosExtractor.ts's
// identical constant for the measurement this is based on.
const MAX_TEXT_CHARS = 120000

export interface ProfstandardDraftStandard {
  code?: string | null
  name?: string | null
}

export interface ProfstandardDraftOtf {
  otf_code:                string
  name:                    string
  qualification_level?:    string | null
  education_requirement?:  string | null
  is_verbatim_verified:    boolean
}

export interface ProfstandardDraft {
  standard: ProfstandardDraftStandard
  otf:      ProfstandardDraftOtf[]
}

interface RawExtraction {
  standard?: { code?: string | null; name?: string | null }
  otf?: {
    otf_code?: string; name?: string
    qualification_level?: string | null; education_requirement?: string | null
  }[]
}

export async function extractProfstandardDraft(text: string): Promise<ProfstandardDraft> {
  const empty: ProfstandardDraft = { standard: {}, otf: [] }
  const source = (text ?? '').trim()
  if (source.length < 40) return empty

  const truncated = source.slice(0, MAX_TEXT_CHARS)

  const system =
    'Вы — методист, разбирающий текст профессионального стандарта. Извлекайте данные строго из ' +
    'текста, ничего не выдумывайте. Формулировки обобщённых трудовых функций (ОТФ) копируйте ' +
    'ДОСЛОВНО из текста, без перефразирования. Отвечайте только валидным JSON.'

  const user =
    `## Текст профессионального стандарта\n${sanitiseForPrompt(truncated)}\n\n` +
    `## Задача\nИзвлеките:\n` +
    `1. "standard": {"code" (код профстандарта, напр. "40.059"), "name" (наименование профстандарта)} ` +
    `— поле null, если не найдено.\n` +
    `2. "otf": массив обобщённых трудовых функций (раздел "III. Характеристика обобщённых трудовых ` +
    `функций"). Для каждой: {"otf_code" (буквенный код, напр. "A"), "name" (ДОСЛОВНАЯ формулировка ОТФ ` +
    `из текста), "qualification_level" (уровень квалификации, напр. "6"), "education_requirement" ` +
    `(текст из графы "Требования к образованию и обучению")}.\n\n` +
    `## Формат\nВерните JSON: {"standard": {...}, "otf": [...]}. Только JSON.`

  // No try/catch — see fgosExtractor.ts:98's comment on the production
  // incident (a silently-swallowed 402 imported 60+ empty drafts) this
  // guards against. Applies identically here.
  const raw = await chatJSON<RawExtraction>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'разбор профстандарта',
    { maxTokens: 8000 },
  )

  const otf: ProfstandardDraftOtf[] = (raw.otf ?? [])
    .filter((o): o is { otf_code: string; name: string; qualification_level?: string | null; education_requirement?: string | null } =>
      !!o.otf_code && !!o.name)
    .map((o) => ({
      otf_code:               o.otf_code,
      name:                   o.name,
      qualification_level:    o.qualification_level ?? null,
      education_requirement:  o.education_requirement ?? null,
      is_verbatim_verified:   validateQuoteAgainstSource(o.name, source) !== null,
    }))

  return {
    standard: {
      code: raw.standard?.code ?? null,
      name: raw.standard?.name ?? null,
    },
    otf,
  }
}
