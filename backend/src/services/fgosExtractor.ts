import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { validateQuoteAgainstSource } from '../lib/citation'

// Feature AA v1 (TODO.md "### AA") — one structured extraction pass over a
// ФГОС document's text. Never writes to the DB (routes/adminFgos.ts owns
// that, only after the admin confirms the review screen — rule #3, AI never
// final). Every competency formulation is verbatim-checked against the
// source text (rule #2) so the review screen can flag anything the LLM may
// have paraphrased instead of quoted.

// A real 12-page ФГОС extracts to ~33-36k chars (~2.7-3k chars/page,
// verified against fgosvo.ru documents) — the old 48000 (copied from
// programImport.ts's MAX_PLAN_CHARS, a different document type) left almost
// no headroom for the 20-40 page documents this format actually runs to,
// so the профстандарты appendix (near the end of the document) risked being
// truncated away before the LLM ever saw it. 120000 covers a full 40-page
// document with room to spare, still far inside the model's context window.
const MAX_TEXT_CHARS = 120000

export interface FgosDraftStandard {
  direction_code?:  string | null
  level?:           string | null
  title?:           string | null
  generation?:      string | null
  order_number?:    string | null
  order_date?:      string | null
  effective_date?:  string | null
}

export interface FgosDraftCompetency {
  type:                 'УК' | 'ОПК'
  code:                 string
  formulation:          string
  is_verbatim_verified: boolean
}

export interface FgosDraftStructureRequirement {
  block_label:  string
  min_credits?: number | null
  max_credits?: number | null
  notes?:       string | null
}

export interface FgosDraftProfstandardRef {
  code:        string
  name:        string
  source_url?: string | null
}

export interface FgosDraft {
  standard:               FgosDraftStandard
  competencies:            FgosDraftCompetency[]
  structureRequirements:   FgosDraftStructureRequirement[]
  profstandardRefs:        FgosDraftProfstandardRef[]
}

interface RawExtraction {
  standard?: {
    direction_code?: string | null; level?: string | null; title?: string | null
    generation?: string | null; order_number?: string | null; order_date?: string | null
    effective_date?: string | null
  }
  competencies?: { type?: string; code?: string; formulation?: string }[]
  structure_requirements?: { block_label?: string; min_credits?: number | null; max_credits?: number | null; notes?: string | null }[]
  profstandard_refs?: { code?: string; name?: string; source_url?: string | null }[]
}

export async function extractFgosDraft(text: string): Promise<FgosDraft> {
  const empty: FgosDraft = { standard: {}, competencies: [], structureRequirements: [], profstandardRefs: [] }
  const source = (text ?? '').trim()
  if (source.length < 40) return empty

  const truncated = source.slice(0, MAX_TEXT_CHARS)

  const system =
    'Вы — методист, разбирающий текст ФГОС ВО (федерального государственного образовательного ' +
    'стандарта высшего образования). Извлекайте данные строго из текста, ничего не выдумывайте. ' +
    'Формулировки компетенций копируйте ДОСЛОВНО из текста, без перефразирования. ' +
    'Отвечайте только валидным JSON.'

  const user =
    `## Текст ФГОС\n${sanitiseForPrompt(truncated)}\n\n` +
    `## Задача\nИзвлеките:\n` +
    `1. "standard": {"direction_code" (код направления, напр. "09.03.04"), "level" (бакалавриат/` +
    `магистратура/специалитет/аспирантура), "title" (наименование направления), "generation" (напр. "3++"), ` +
    `"order_number" (номер приказа Минобрнауки), "order_date" (дата приказа, ГГГГ-ММ-ДД), ` +
    `"effective_date" (дата вступления в силу, ГГГГ-ММ-ДД)} — любое поле null, если не найдено.\n` +
    `2. "competencies": массив УК и ОПК. Для каждой: {"type": "УК" или "ОПК", "code" (напр. "УК-1"), ` +
    `"formulation" (ДОСЛОВНАЯ формулировка компетенции из текста)}.\n` +
    `3. "structure_requirements": требования к объёму блоков учебного плана в з.е. Для каждого блока: ` +
    `{"block_label" (напр. "Блок 1. Дисциплины (модули)"), "min_credits", "max_credits", "notes"}.\n` +
    `4. "profstandard_refs": перечень профессиональных стандартов из приложения к ФГОС. Для каждого: ` +
    `{"code" (напр. "06.001"), "name" (наименование профстандарта), "source_url" (если указан)}.\n\n` +
    `## Формат\nВерните JSON: {"standard": {...}, "competencies": [...], "structure_requirements": [...], ` +
    `"profstandard_refs": [...]}. Только JSON.`

  let raw: RawExtraction
  try {
    raw = await chatJSON<RawExtraction>(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      'разбор ФГОС',
      { maxTokens: 8000 },
    )
  } catch {
    return empty
  }

  const competencies: FgosDraftCompetency[] = (raw.competencies ?? [])
    .filter((c): c is { type: string; code: string; formulation: string } =>
      (c.type === 'УК' || c.type === 'ОПК') && !!c.code && !!c.formulation)
    .map((c) => ({
      type:                 c.type as 'УК' | 'ОПК',
      code:                 c.code,
      formulation:          c.formulation,
      is_verbatim_verified: validateQuoteAgainstSource(c.formulation, source) !== null,
    }))

  const structureRequirements: FgosDraftStructureRequirement[] = (raw.structure_requirements ?? [])
    .filter((r): r is { block_label: string; min_credits?: number | null; max_credits?: number | null; notes?: string | null } => !!r.block_label)
    .map((r) => ({
      block_label: r.block_label,
      min_credits: r.min_credits ?? null,
      max_credits: r.max_credits ?? null,
      notes:       r.notes ?? null,
    }))

  const profstandardRefs: FgosDraftProfstandardRef[] = (raw.profstandard_refs ?? [])
    .filter((p): p is { code: string; name: string; source_url?: string | null } => !!p.code && !!p.name)
    .map((p) => ({ code: p.code, name: p.name, source_url: p.source_url ?? null }))

  return {
    standard: {
      direction_code: raw.standard?.direction_code ?? null,
      level:          raw.standard?.level ?? null,
      title:          raw.standard?.title ?? null,
      generation:     raw.standard?.generation ?? null,
      order_number:   raw.standard?.order_number ?? null,
      order_date:     raw.standard?.order_date ?? null,
      effective_date: raw.standard?.effective_date ?? null,
    },
    competencies,
    structureRequirements,
    profstandardRefs,
  }
}
