import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type { VacancySnapshot } from './labourMarket'

// РОП Студия v0 (TODO.md Feature Z, Phase 0) — one structured generation
// pass producing the «обоснование актуальности» (market-relevance
// justification) section text. Unlike grading's citation validation
// (lib/citation.ts's validateQuoteAgainstSource, which verbatim-matches a
// quote against free-text source documents), the "citations" here are
// structured data we already fetched ourselves (vacancy counts/dates,
// профстандарт codes/names) — there's no free text to verbatim-match
// against. The safety mechanism instead is that the UI always renders the
// generated text next to the raw source data it was built from
// (routes/programs.ts's market-evidence response includes both), so a human
// reviewer checks the prose against the real numbers directly rather than
// trusting an automated match.

export interface ProfstandardRef {
  code: string
  name: string
}

export interface GenerateMarketEvidenceParams {
  programTitle:  string
  profstandards: ProfstandardRef[]
  snapshot:      VacancySnapshot
  teacherId:     string
  institutionId?: string
}

interface RawGeneration {
  text?: string
}

/**
 * Generates the section text. Never writes to the DB — routes/programs.ts
 * owns persistence, only after this returns (rule #3: AI never final —
 * the РОП reviews/edits before the text is used in an official document).
 */
export async function generateMarketEvidenceSection(
  params: GenerateMarketEvidenceParams
): Promise<{ text: string }> {
  const system =
    'Вы — методист, помогающий обосновать востребованность образовательной программы на рынке труда. ' +
    'Пишете раздел «Обоснование актуальности» для документа, который будет представлен учёному совету. ' +
    'Используйте СТРОГО ТОЛЬКО данные из предоставленного JSON — коды и названия профстандартов, ' +
    'количества вакансий, даты, названия работодателей. НИКОГДА не придумывайте цифры, коды или ' +
    'профстандарты, которых нет в данных. Если данных недостаточно для какого-то утверждения, ' +
    'не делайте это утверждение. Пишите по-русски, деловым стилем, 2-4 абзаца. ' +
    'Обязательно указывайте дату среза данных (по состоянию на …). Если регионов несколько, ' +
    'приводите данные по каждому региону отдельно, а не только по одному. ' +
    'Отвечайте только валидным JSON.'

  const context = {
    programTitle:  params.programTitle,
    profstandards: params.profstandards,
    fetched_at:    params.snapshot.fetched_at,
    regions:       params.snapshot.regions.map((r) => ({
      region: r.region_name,
      vacancies: r.by_profession.map((p) => ({
        term: p.term,
        total: p.total,
        examples: p.sample.map((s) => ({ title: s.title, employer: s.employer, salary: s.salary, date: s.date })),
      })),
    })),
  }

  const user =
    `## Данные\n${sanitiseForPrompt(JSON.stringify(context, null, 2))}\n\n` +
    `## Задача\nНапишите раздел «Обоснование актуальности» для направления ` +
    `«${params.programTitle}», используя только данные выше.\n\n` +
    `## Формат\nВерните JSON: {"text": "..."}. Только JSON.`

  const raw = await chatJSON<RawGeneration>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'обоснование актуальности',
    {
      context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'presentation' },
      maxTokens: 2000,
    },
  )

  return { text: (raw.text ?? '').trim() }
}
