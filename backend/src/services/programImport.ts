import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type { ProgramDiscipline, ProgramCompetency } from '../../../shared/types'

// Parses the two PDFs of the intake form into the structures the analysis needs:
//   • учебный план  → ordered disciplines (semester, credits, control form)
//   • описание ОП   → competencies (УК/ОПК/ПК) + goals (reuses extractDeclared)
// Extraction (PDF → text) happens upstream in the route via documentExtractor.

const MAX_PLAN_CHARS = 16000

// ── Учебный план → disciplines ──────────────────────────────────────────────────

export async function parseStudyPlan(params: {
  teacherId:      string
  institutionId?: string
  planText:       string
}): Promise<ProgramDiscipline[]> {
  const text = (params.planText ?? '').trim().slice(0, MAX_PLAN_CHARS)
  if (text.length < 40) return []

  const system =
    'Вы — методист российского вуза. Вы извлекаете перечень дисциплин из учебного плана ' +
    '(направления подготовки) с указанием семестра, трудоёмкости и формы контроля. ' +
    'Берите данные строго из текста, ничего не выдумывайте. Отвечайте только валидным JSON на русском.'

  const user =
    `## Учебный план\n${sanitiseForPrompt(text)}\n\n` +
    `## Задача\nИзвлеките дисциплины (предметы). Для каждой укажите:\n` +
    `- "name": название дисциплины;\n` +
    `- "semester": НОМЕР СЕМЕСТРА (сквозной, 1..N по всей программе). Если план указывает курс и ` +
    `семестр внутри курса, пересчитайте: семестр = (курс − 1) × 2 + семестр_в_курсе. Если дисциплина ` +
    `идёт несколько семестров — укажите семестр её начала;\n` +
    `- "credits": зачётные единицы (ЗЕТ), число, либо null;\n` +
    `- "control_form": форма контроля (например «экзамен», «зачёт», «диф. зачёт», «курсовая»), либо null.\n` +
    `Не включайте строки-заголовки разделов, итоги, практики без названия и блоки без дисциплин.\n\n` +
    `## Формат\nВерните JSON: {"disciplines":[{"name":"...","semester":1,"credits":4,"control_form":"экзамен"}]}. Только JSON.`

  const result = await chatJSON<{
    disciplines?: { name?: string; semester?: number; credits?: number | null; control_form?: string | null }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'разбор учебного плана',
    { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 3500 },
  )

  const perSemester = new Map<number, number>()
  return (result.disciplines ?? [])
    .map((d) => {
      const name = String(d.name ?? '').trim()
      let semester = Number(d.semester)
      if (!Number.isFinite(semester) || semester < 1) semester = 1
      semester = Math.min(Math.round(semester), 16)
      const credits = typeof d.credits === 'number' && isFinite(d.credits) ? d.credits : null
      const control_form = d.control_form ? String(d.control_form).trim() : null
      const sort = perSemester.get(semester) ?? 0
      perSemester.set(semester, sort + 1)
      return { name, semester, credits, control_form, sort_order: sort }
    })
    .filter((d) => d.name.length > 1)
    .slice(0, 80)
    .map((d): ProgramDiscipline => ({
      course_id: null,
      name: d.name,
      semester: d.semester,
      credits: d.credits,
      control_form: d.control_form,
      competency_codes: [],
      sort_order: d.sort_order,
    }))
}

// ── Описание ОП → competencies + goals ──────────────────────────────────────────
// ОП descriptions are large (50–100k chars) and the УК/ОПК/ПК codes appear both
// in the definition table and the competency-discipline matrix, with various
// dashes and ИД-индикаторы interleaved. Feeding a 14k slice to an РПД parser
// misses them. Instead we extract definitions deterministically: find each
// unique code where it's followed by a formulation verb (Способен/Готов/…),
// capture the formulation. This is reliable regardless of document size and
// needs no LLM call. Goals are pulled best-effort from the «цель ООП» sentence.

const CODE = '(?:ОПК|УК|ПКС|ПК)'
const DASH = '[-–—‒―]'

export function parseDescription(params: {
  teacherId:        string
  descriptionText:  string
}): ProgramCompetency[] {
  const text = (params.descriptionText ?? '').replace(/ /g, ' ')
  if (text.trim().length < 40) return []

  const defRe = new RegExp(
    `(${CODE})\\s*${DASH}\\s*(\\d+)\\s*\\.?\\s*` +
    `(Способен|Способность|Готов[а-я]*|Владе[а-я]*|Умеет|Знает)` +
    `([\\s\\S]{0,300}?)(?=(?:${CODE})\\s*${DASH}\\s*\\d|ИД[-\\s]|\\n[А-ЯA-Z]|\\.\\s|$)`,
    'g'
  )

  const seen = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = defRe.exec(text)) !== null) {
    const code = `${m[1]}-${m[2]}`
    if (seen.has(code)) continue
    const title = `${m[3]}${m[4]}`.replace(/\s+/g, ' ').trim().replace(/[;,.]\s*$/, '')
    if (title.length > 8) seen.set(code, title)
  }

  // Order: УК, then ОПК, then ПК/ПКС, each by numeric code.
  const rank = (c: string) => (c.startsWith('УК') ? 0 : c.startsWith('ОПК') ? 1 : 2)
  const entries = [...seen.entries()].sort((a, b) => {
    const r = rank(a[0]) - rank(b[0])
    if (r !== 0) return r
    return (parseInt(a[0].split('-')[1], 10) || 0) - (parseInt(b[0].split('-')[1], 10) || 0)
  })

  const out: ProgramCompetency[] = []
  let order = 0

  const goal = extractGoal(text)
  if (goal) out.push({ kind: 'goal', code: null, title: goal, sort_order: order++ })

  for (const [code, title] of entries) {
    out.push({ kind: 'competency', code, title, sort_order: order++ })
  }
  return out.slice(0, 60)
}

function extractGoal(text: string): string | null {
  const m = text.match(/цел[ьяи][^.]{0,40}?(?:ООП|ОПОП|образовательной программы)[^.]{0,40}?(?:является|состоит в)[:\s]+([^.]{20,280}\.)/i)
  if (!m) return null
  return m[1].replace(/\s+/g, ' ').trim()
}
