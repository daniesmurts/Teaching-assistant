import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type { ProgramDiscipline, ProgramCompetency } from '../../../shared/types'

// Parses the two PDFs of the intake form into the structures the analysis needs:
//   • учебный план  → ordered disciplines (semester, credits, control form)
//   • описание ОП   → competencies (УК/ОПК/ПК) + goals (reuses extractDeclared)
// Extraction (PDF → text) happens upstream in the route via documentExtractor.

// A full 4-year учебный план with a ЗЕТ table runs well past the old 16k slice,
// so the tail (later semesters) was silently truncated → year-4 credits went
// missing and the load chart under-counted. V4 handles the larger context.
const MAX_PLAN_CHARS = 48000

// ── Учебный план → disciplines ──────────────────────────────────────────────────

export interface StudyPlanParse {
  disciplines: ProgramDiscipline[]
  // Per-semester totals as read from the plan's own «Итого/Всего» rows. Used
  // by deriveLoadCheck to reconcile the sum of extracted disciplines against
  // what the plan itself asserts — a mismatch is a direct signal of a
  // truncated/mis-parsed extraction.
  reported_semester_totals?: Record<number, number>
}

export async function parseStudyPlan(params: {
  teacherId:      string
  institutionId?: string
  planText:       string
}): Promise<StudyPlanParse> {
  const text = (params.planText ?? '').trim().slice(0, MAX_PLAN_CHARS)
  if (text.length < 40) return { disciplines: [] }

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
    `- "credits": зачётные единицы (ЗЕТ), число, либо null. Извлекайте ЗЕТ точно из ` +
    `соответствующей строки таблицы — не путайте с часами и не берите значение соседней дисциплины;\n` +
    `- "control_form": форма контроля (например «экзамен», «зачёт», «диф. зачёт», «курсовая»), либо null.\n` +
    `Извлеките ВСЕ дисциплины по ВСЕМ семестрам до последнего — включая практики, курсовые работы/проекты ` +
    `и государственную итоговую аттестацию (ВКР), если у них указаны ЗЕТ. Не останавливайтесь на середине ` +
    `плана. Не включайте строки-заголовки разделов, строки «Итого/Всего» и блоки без дисциплин.\n\n` +
    `Дополнительно: если в учебном плане присутствуют СТРОКИ ИТОГОВ ПО СЕМЕСТРАМ ` +
    `(«Итого за семестр 1: 30 з.е.», «Всего за 3 сем.: 32 з.е.» и т.п.), верните их в отдельном ` +
    `массиве "semester_totals" — это нужно, чтобы система могла сверить сумму ЗЕТ извлечённых ` +
    `дисциплин с тем, что фактически указано в плане. Если таких итоговых строк нет — верните ` +
    `пустой массив.\n\n` +
    `## Формат\nВерните JSON: {"disciplines":[{"name":"...","semester":1,"credits":4,"control_form":"экзамен"}],` +
    `"semester_totals":[{"semester":1,"credits":30}]}. Только JSON.`

  const result = await chatJSON<{
    disciplines?: { name?: string; semester?: number; credits?: number | null; control_form?: string | null }[]
    semester_totals?: { semester?: number; credits?: number }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'разбор учебного плана',
    { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 8000 },
  )

  const perSemester = new Map<number, number>()
  let lastSemester = 1   // учебные планы идут по семестрам подряд — пропущенный
                         // семестр почти всегда совпадает с предыдущей строкой,
                         // а не относится к 1-му (иначе сем.1 раздувается)
  const disciplines = (result.disciplines ?? [])
    .map((d) => {
      const name = String(d.name ?? '').trim()
      const raw = Number(d.semester)
      let semester: number
      if (Number.isFinite(raw) && raw >= 1) {
        semester = Math.min(Math.round(raw), 16)
        lastSemester = semester
      } else {
        semester = lastSemester   // carry forward rather than dumping into сем.1
      }
      const credits = typeof d.credits === 'number' && isFinite(d.credits) ? d.credits : null
      const control_form = d.control_form ? String(d.control_form).trim() : null
      const sort = perSemester.get(semester) ?? 0
      perSemester.set(semester, sort + 1)
      return { name, semester, credits, control_form, sort_order: sort }
    })
    .filter((d) => d.name.length > 1)
    .slice(0, 150)
    .map((d): ProgramDiscipline => ({
      course_id: null,
      name: d.name,
      semester: d.semester,
      credits: d.credits,
      control_form: d.control_form,
      competency_codes: [],
      sort_order: d.sort_order,
    }))

  // Semester totals as reported by the plan itself — used for reconciliation.
  const reported: Record<number, number> = {}
  for (const t of result.semester_totals ?? []) {
    const s = Number(t.semester), c = Number(t.credits)
    if (Number.isFinite(s) && s >= 1 && s <= 16 && Number.isFinite(c) && c > 0) {
      reported[Math.round(s)] = c
    }
  }

  return {
    disciplines,
    reported_semester_totals: Object.keys(reported).length > 0 ? reported : undefined,
  }
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

// ── Competency matrix (discipline × competency) ────────────────────────────
//
// The описание ОП and учебный план both contain a матрица компетенций — a table
// showing which competencies each discipline forms. Extracting it authoritatively
// eliminates the УК/ОПК "не покрыто" false alarms that come from name-inference,
// and unblocks the mapping-confidence guard from firing on a well-populated plan.
//
// This runs at import time and returns discipline-NAME → codes[], which the
// route then maps onto the just-inserted disciplines (name-normalised) and
// persists as `competency_codes`. Best-effort: a failed pass leaves discipline
// codes empty; the pre-existing РПД-upload auto-detect still populates them
// per-discipline as the user uploads РПД files.
const MATRIX_MAX_CHARS = 60000

export async function parseCompetencyMatrix(params: {
  teacherId:      string
  institutionId?: string
  descriptionText: string
  validCodes:     string[]   // filter — only competencies actually declared on the programme
}): Promise<Map<string, string[]>> {
  const text = (params.descriptionText ?? '').slice(0, MATRIX_MAX_CHARS)
  if (text.trim().length < 500 || params.validCodes.length === 0) return new Map()

  const validSet = new Set(params.validCodes.map((c) => c.trim().toUpperCase()))

  const system =
    'Вы — методист российского вуза. В описании образовательной программы обычно есть матрица ' +
    'компетенций — таблица, где для каждой дисциплины перечислены компетенции (УК/ОПК/ПК), ' +
    'которые она формирует. Ваша задача — извлечь эту матрицу. Отвечайте только валидным JSON на русском.'

  const user =
    `## Возможные коды компетенций программы\n${params.validCodes.join(', ')}\n\n` +
    `## Текст описания ОП\n<document>\n${sanitiseForPrompt(text)}\n</document>\n\n` +
    `## Задача\nНайдите матрицу компетенций (таблицу «дисциплина × компетенции», либо ` +
    `перечень «Дисциплина X формирует компетенции: …»). Для КАЖДОЙ дисциплины из матрицы ` +
    `верните её точное название и список кодов компетенций (только из списка выше — коды, ` +
    `которых нет в списке, игнорируйте). Если матрицы нет — верните пустой массив.\n\n` +
    `## Формат ответа\n{"assignments":[{"discipline":"Философия","codes":["УК-1","УК-5"]}]}. Только JSON.`

  try {
    const result = await chatJSON<{
      assignments?: { discipline?: string; codes?: unknown }[]
    }>(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      'извлечение матрицы компетенций',
      { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 6000 },
    )
    const out = new Map<string, string[]>()
    for (const row of result.assignments ?? []) {
      const name = String(row.discipline ?? '').trim()
      if (name.length < 2) continue
      const codes: string[] = []
      const seen = new Set<string>()
      const raw = Array.isArray(row.codes) ? row.codes : []
      for (const item of raw) {
        if (typeof item !== 'string') continue
        const norm = item.trim().toUpperCase()
        if (!validSet.has(norm) || seen.has(norm)) continue
        seen.add(norm)
        const original = params.validCodes.find((c) => c.trim().toUpperCase() === norm)
        if (original) codes.push(original)
      }
      if (codes.length > 0) out.set(name, codes)
    }
    return out
  } catch {
    return new Map()
  }
}
