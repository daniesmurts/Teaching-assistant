import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { ValidationError } from '../errors/AppError'
import { BRS_SEMESTER_MIN, BRS_SEMESTER_MAX } from '../config/brs'
import type { SyllabusDraft, SyllabusSection } from '../../../shared/types'
import type { CompetencyInput } from './syllabusReview'

// КНИТУ teacher feature T5 — «РПД-студия». AI drafts (or updates) syllabus content
// aimed at the target ОПК/ПК/УК + goals. Same generation pattern as the
// presentation/quiz/topic generators, spec'd by the competency framework instead of
// a lecture topic. Pairs with reviewSyllabus into a write → check → fix loop; the
// teacher (разработчик РПД) remains the author of record. This function itself stays
// pure/unpersisted — routes/curriculum.ts saves the result to syllabus_studio_drafts.

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
    `2. "Планируемые результаты обучения" — для каждой компетенции строго в формате:\n` +
    `   ПК-N: <формулировка компетенции>\n` +
    `   - Знать: 3 варианта формулировки через "; " — например: «а) ...; б) ...; в) ...» (каждый увязан с темами в скобках, например «(темы 1.1–1.2)»)\n` +
    `   - Уметь: 3 варианта формулировки в том же формате\n` +
    `   - Владеть: 3 варианта формулировки в том же формате\n` +
    `   Три варианта — это РАЗНЫЕ по формулировке и/или фокусу способы описать один и тот же результат обучения ` +
    `(например: более общая формулировка / более конкретная с примером / формулировка через измеримый критерий), ` +
    `а не три произвольных разных результата. Преподаватель сам выберет или скомпонует нужный вариант при редактировании.\n` +
    `3. "Содержание дисциплины (темы)" — тематический план: разделы и темы с кратким описанием, спроектированные так, чтобы покрыть все компетенции и цели.\n` +
    `4. "Формы текущего контроля и промежуточной аттестации" — конкретные формы (лабораторные, проект, экзамен и т.п.), привязанные к компетенциям.\n` +
    `Поле "content" — связный текст на русском, можно с переносами строк для перечислений.\n\n` +
    `Дополнительно верните "instruments" — плоский список названий оценочных средств из раздела 4 ` +
    `(например ["Лабораторная работа", "Контрольная работа", "Экзамен"]). Обязательно включите форму ` +
    `промежуточной аттестации (экзамен или зачёт). БАЛЛЫ НЕ УКАЗЫВАЙТЕ — их расставит система.\n` +
    `Ответьте ТОЛЬКО JSON-объектом: {"sections":[...],"instruments":[...]}.`

  const result = await chatJSON<{
    sections: { heading?: string; content?: string }[]
    instruments?: unknown
  }>(
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

  // §9 is drafted here rather than asked of the model, because it is the one
  // section with a hard arithmetic constraint: each semester must total
  // exactly 60/100. Models do not reliably make columns add up, and a §9 that
  // misses the total is precisely what blocks a conformant ФОС downstream —
  // so the model names the instruments and the code assigns the points.
  const instrumentNames = Array.isArray(result.instruments)
    ? result.instruments.map((v) => String(v ?? '').trim()).filter(Boolean)
    : []
  const brsSection = buildBrsSection(instrumentNames)
  if (brsSection) sections.push(brsSection)

  return { mode: improving ? 'improve' : 'draft', sections, generated_at: new Date().toISOString() }
}

/** Flatten draft sections into a single text blob — feeds the conformance check. */
export function draftToText(draft: SyllabusDraft): string {
  return draft.sections.map((s) => `${s.heading}\n${s.content}`).join('\n\n')
}


// ── §9 «Использование рейтинговой системы оценки знаний» ────────────────────

/**
 * Builds the БРС table from the instruments the draft declared, distributing
 * BRS_SEMESTER_MIN/MAX across them so the semester totals are exact.
 *
 * Промежуточная аттестация (экзамен/зачёт) is weighted at roughly 40% of the
 * scale, matching the макет's own worked example (экзамен 24/40 of 60/100);
 * the rest is split evenly across текущий контроль. These are starting
 * numbers a teacher is expected to adjust — the point is that whatever they
 * start from already adds up, so §9 is never born non-conformant.
 */
export function buildBrsSection(instruments: string[]): SyllabusSection | null {
  const names = [...new Set(instruments.map((s) => s.trim()).filter(Boolean))]
  if (names.length === 0) return null

  const finalIdx = names.findIndex((n) => /экзамен|зач[еёе]т/i.test(n))
  const rows = allocateBrsPoints(names, finalIdx)

  const lines = [
    'Оценочные средства | Кол-во | Мин. баллов | Макс. баллов',
    ...rows.map((r) => `${r.name} | 1 | ${r.min} | ${r.max}`),
    `Итого: |  | ${rows.reduce((n, r) => n + r.min, 0)} | ${rows.reduce((n, r) => n + r.max, 0)}`,
  ]

  return {
    heading: 'Использование рейтинговой системы оценки знаний (п.9)',
    content:
      'Максимальное и минимальное количество баллов по видам учебной работы описано в «Положении о ' +
      'балльно-рейтинговой системе оценки знаний студентов» ФГБОУ ВО КНИТУ. Баллы распределены так, ' +
      `чтобы за семестр набиралось ${BRS_SEMESTER_MIN} минимальных и ${BRS_SEMESTER_MAX} максимальных — ` +
      'при необходимости перераспределите их между контрольными точками, сохранив итог.\n\n' +
      lines.join('\n'),
  }
}

/** Splits the semester budget across instruments, exactly. Exported for tests. */
export function allocateBrsPoints(
  names: string[], finalIdx: number,
): { name: string; min: number; max: number }[] {
  const hasFinal = finalIdx >= 0 && names.length > 1
  // ~40% to промежуточная аттестация when there is one, matching the макет's
  // экзамен 24/40 against a 60/100 scale.
  const finalMin = hasFinal ? Math.round(BRS_SEMESTER_MIN * 0.4) : 0
  const finalMax = hasFinal ? Math.round(BRS_SEMESTER_MAX * 0.4) : 0

  const currentNames = names.filter((_, i) => !(hasFinal && i === finalIdx))
  const spread = (total: number, n: number): number[] => {
    if (n <= 0) return []
    const base = Math.floor(total / n)
    const rem = total - base * n
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
  }
  const mins = spread(BRS_SEMESTER_MIN - finalMin, currentNames.length)
  const maxes = spread(BRS_SEMESTER_MAX - finalMax, currentNames.length)

  let k = 0
  return names.map((name, i) => {
    if (hasFinal && i === finalIdx) return { name, min: finalMin, max: finalMax }
    const row = { name, min: mins[k] ?? 0, max: maxes[k] ?? 0 }
    k += 1
    return row
  })
}
