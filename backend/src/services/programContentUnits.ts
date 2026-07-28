import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { parseSyllabusContentSections } from './syllabusReview'
import type { ContentSection } from '../../../shared/types'

// Topology graph substrate (docs/topology-spec.md, Increment 0) — first-class
// content below the whole-section blob syllabusReview.ts's parser works at.
// Two-stage, mirroring that same file's extract-then-analyze pattern: reuse
// its existing section-blob extraction (parseSyllabusContentSections), then
// run one further chatJSON pass per non-empty section to split that blob
// into individual titled units. No verbatim-quote citation validation here —
// nothing downstream cites content-unit text yet.

const SECTIONS: ContentSection[] = ['lectures', 'practicals', 'labs', 'independent', 'control']
const MAX_BLOB_CHARS = 6000

export interface ExtractedContentUnit {
  section:  ContentSection
  title:    string
  topics:   string[]
}

export async function extractContentUnits(
  teacherId: string, disciplineText: string, disciplineName: string
): Promise<ExtractedContentUnit[]> {
  const sections = await parseSyllabusContentSections(teacherId, disciplineText)
  const out: ExtractedContentUnit[] = []
  for (const section of SECTIONS) {
    const blob = sections[section]
    if (!blob) continue
    out.push(...await extractSectionUnits(teacherId, disciplineName, section, blob))
  }
  return out
}

async function extractSectionUnits(
  teacherId: string, disciplineName: string, section: ContentSection, blob: string
): Promise<ExtractedContentUnit[]> {
  const system =
    'Вы — методист российского вуза. Вы разбираете раздел содержания рабочей программы дисциплины ' +
    'на отдельные темы/занятия. Берите формулировки из текста, не выдумывайте. Отвечайте только ' +
    'валидным JSON на русском языке.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(disciplineName)}\n\n` +
    `## Раздел содержания (${section})\n${sanitiseForPrompt(blob.slice(0, MAX_BLOB_CHARS))}\n\n` +
    `## Задача\nРазбейте раздел на отдельные единицы содержания (каждая лекция, практическое ` +
    `занятие, лабораторная работа или иной пункт — отдельной единицей). Для каждой единицы:\n` +
    `- "title": короткое название темы/занятия,\n` +
    `- "topics": массив кратких подтем/вопросов в рамках этой единицы (может быть пустым).\n\n` +
    `## Формат ответа\nВерните JSON: {"units":[{"title":"...","topics":["..."]}]}. Только JSON.`

  const result = await chatJSON<{ units?: { title?: string; topics?: unknown }[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'разбиение раздела РПД на единицы содержания',
    // temperature 0 — pure structural extraction, same determinism rationale
    // as syllabusReview.ts's own parse pass.
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  return (result.units ?? [])
    .map((u) => ({
      section,
      title:  String(u.title ?? '').trim(),
      topics: Array.isArray(u.topics) ? u.topics.map((t) => String(t ?? '').trim()).filter(Boolean) : [],
    }))
    .filter((u) => u.title.length > 0)
}
