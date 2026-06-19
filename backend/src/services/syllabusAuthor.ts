import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { ValidationError } from '../errors/AppError'
import type { SyllabusDraft, SyllabusSection } from '../../../shared/types'
import type { CompetencyInput } from './syllabusReview'

// КНИТУ teacher feature T5 — «РПД-студия». AI drafts (or updates) syllabus content
// aimed at the target ОПК/ПК/УК + goals. Same generation pattern as the
// presentation/quiz/topic generators, spec'd by the competency framework instead of
// a lecture topic. Pairs with reviewSyllabus into a write → check → fix loop; the
// teacher (разработчик РПД) remains the author of record. Computed live, not persisted.

const MAX_COMPETENCIES   = 20
const MAX_GOALS          = 12
const MAX_CURRENT_CHARS  = 8000
const MAX_GAPS           = 20

export interface DraftParams {
  teacherId:      string
  disciplineName: string
  level?:         string
  competencies:   CompetencyInput[]
  goals:          string[]
  currentContent?: string    // when revising an existing РПД rather than drafting fresh
  gaps?:           string[]   // recommendations from a prior conformance check to address
}

export async function draftSyllabus(p: DraftParams): Promise<SyllabusDraft> {
  const competencies = (p.competencies ?? []).filter((c) => c.title?.trim()).slice(0, MAX_COMPETENCIES)
  const goals        = (p.goals ?? []).filter((g) => g?.trim()).slice(0, MAX_GOALS)
  if (competencies.length === 0 && goals.length === 0) {
    throw new ValidationError('Укажите компетенции (ОПК/ПК/УК) или цели, под которые нужно подготовить содержание.')
  }

  const current   = (p.currentContent ?? '').trim().slice(0, MAX_CURRENT_CHARS)
  const improving = current.length > 0
  const gaps      = (p.gaps ?? []).filter(Boolean).slice(0, MAX_GAPS)

  const compBlock = competencies.length
    ? competencies.map((c) => `- [${sanitiseForPrompt(c.code || 'без кода')}] ${sanitiseForPrompt(c.title)}`).join('\n')
    : '— не заданы —'
  const goalBlock = goals.length ? goals.map((g) => `- ${sanitiseForPrompt(g)}`).join('\n') : '— не заданы —'

  const system =
    'Вы — методист российского вуза, разрабатывающий рабочие программы дисциплин (РПД) ' +
    'в соответствии с ФГОС ВО. Вы проектируете содержание дисциплины так, чтобы оно ' +
    'действительно обеспечивало заданные компетенции и цели. Отвечайте только валидным ' +
    'JSON на русском языке.'

  const task = improving
    ? `## Текущее содержание РПД (требует доработки)\n<current>\n${sanitiseForPrompt(current)}\n</current>\n\n` +
      (gaps.length ? `## Выявленные пробелы (устраните их)\n${gaps.map((g) => `- ${sanitiseForPrompt(g)}`).join('\n')}\n\n` : '') +
      `## Задача\nДоработайте содержание РПД так, чтобы закрыть пробелы и обеспечить все ` +
      `перечисленные компетенции и цели. Сохраните удачные части, дополните недостающее.`
    : `## Задача\nПодготовьте содержание РПД для дисциплины так, чтобы оно обеспечивало все ` +
      `перечисленные компетенции и цели.`

  const user =
    `## Дисциплина\n${sanitiseForPrompt(p.disciplineName)}${p.level ? ` (уровень: ${sanitiseForPrompt(p.level)})` : ''}\n\n` +
    `## Целевые компетенции (ОПК/ПК/УК)\n${compBlock}\n\n## Целевые цели и результаты\n${goalBlock}\n\n` +
    `${task}\n\n` +
    `## Формат ответа\nВерните JSON: {"sections":[{"heading":"...","content":"..."}]} со следующими разделами (именно в этом порядке):\n` +
    `1. "Цели освоения дисциплины" — 2–4 цели.\n` +
    `2. "Планируемые результаты обучения" — для каждой компетенции: что студент должен знать / уметь / владеть, увязанное с темами.\n` +
    `3. "Содержание дисциплины (темы)" — тематический план: разделы и темы с кратким описанием, спроектированные так, чтобы покрыть все компетенции и цели.\n` +
    `4. "Формы текущего контроля и промежуточной аттестации" — конкретные формы (лабораторные, проект, экзамен и т.п.), привязанные к компетенциям.\n` +
    `Поле "content" — связный текст на русском, можно с переносами строк для перечислений. Ответьте ТОЛЬКО JSON-объектом.`

  const result = await chatJSON<{ sections: { heading?: string; content?: string }[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'содержание РПД',
    { context: { teacherId: p.teacherId, feature: 'presentation' } },   // reuse a logged generation bucket
  )

  const sections: SyllabusSection[] = (result.sections ?? [])
    .map((s) => ({ heading: String(s.heading ?? '').trim(), content: String(s.content ?? '').trim() }))
    .filter((s) => s.heading && s.content)

  if (sections.length === 0) {
    throw new ValidationError('Не удалось подготовить содержание. Попробуйте уточнить компетенции и цели.')
  }

  return { mode: improving ? 'improve' : 'draft', sections, generated_at: new Date().toISOString() }
}

/** Flatten draft sections into a single text blob — feeds the conformance check. */
export function draftToText(draft: SyllabusDraft): string {
  return draft.sections.map((s) => `${s.heading}\n${s.content}`).join('\n\n')
}
