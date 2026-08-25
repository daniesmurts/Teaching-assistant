import { isTotalRow } from '../lib/ruText'
import { catalogueEntryFor } from './fosMacketReference'
import { BRS_SEMESTER_MIN, BRS_SEMESTER_MAX, FINAL_ATTESTATION } from '../config/brs'
import type { BrsScoreRow, BrsReadinessCheck, BrsReadinessFinding } from '../../../shared/types'

// «Готов ли п.9 к тому, чтобы из него собрался корректный ФОС».
//
// The other end of the chain: the макет says a ФОС's «Перечень оценочных
// средств» is the discipline's §9, so a §9 that is incomplete, contradictory,
// or doesn't total 60/100 cannot yield a conformant ФОС however carefully the
// ФОС itself is written. Everything here is arithmetic or list membership —
// deterministic, no model.
//
// Runs whether or not a ФОС exists, because its whole point is to catch the
// problem at authoring time: the teacher writing §9 sees it now, instead of a
// методист finding it after a ФОС has been built on top of it.

const semKey = (s: string | null) => (s ?? '').trim().toLowerCase() || '—'
const semLabel = (s: string | null) => (s && s.trim()) || 'без разбивки по семестрам'

export function checkBrsReadiness(brsItems: BrsScoreRow[]): BrsReadinessCheck {
  const rows = brsItems.filter((b) => !isTotalRow(b.name))

  if (rows.length === 0) {
    return {
      checked: false, ready: false, findings: [],
      summary: 'В п.9 не найдено контрольных точек — из такого раздела ФОС собрать нельзя.',
    }
  }

  const findings: BrsReadinessFinding[] = []

  for (const r of rows) {
    if (r.min_points == null || r.max_points == null) {
      const which = r.min_points == null && r.max_points == null
        ? 'минимальный и максимальный баллы'
        : r.min_points == null ? 'минимальный балл' : 'максимальный балл'
      findings.push({
        kind: 'missing_points', severity: 'error',
        instrument: r.name, semester: r.semester,
        detail: `Для «${r.name}» в п.9 не указан ${which}.`,
        recommendation: `Укажите и минимальный, и максимальный балл — в ФОС по макету это отдельные ` +
                        `столбцы «Min, баллов (базовый уровень)» и «Max, баллов (повышенный уровень)».`,
      })
    } else if (r.min_points > r.max_points) {
      findings.push({
        kind: 'min_above_max', severity: 'error',
        instrument: r.name, semester: r.semester,
        detail: `Для «${r.name}» минимальный балл (${r.min_points}) больше максимального (${r.max_points}).`,
        recommendation: 'Проверьте, не перепутаны ли столбцы минимального и максимального баллов.',
      })
    }

    // Not an error: a кафедра may legitimately use an instrument the макет
    // never listed. It only means the generated ФОС will have no «краткая
    // характеристика» row for it, which the teacher then writes themselves.
    // Промежуточная аттестация is skipped outright — the макет deliberately
    // keeps экзамен/зачёт out of that catalogue, so checking them against it
    // would flag almost every РПД in the university.
    if (!FINAL_ATTESTATION.test(r.name) && !catalogueEntryFor(r.name)) {
      findings.push({
        kind: 'unknown_instrument', severity: 'warning',
        instrument: r.name, semester: r.semester,
        detail: `«${r.name}» не найдено в перечне оценочных средств макета ФОС.`,
        recommendation: `Проверьте формулировку — если это нестандартное оценочное средство, ` +
                        `его краткую характеристику придётся описать в ФОС вручную.`,
      })
    }
  }

  // Each semester has to add up to the положение's 60/100. Per semester, not
  // per discipline: a multi-semester РПД budgets 60/100 in each one.
  for (const key of [...new Set(rows.map((r) => semKey(r.semester)))]) {
    const inSem = rows.filter((r) => semKey(r.semester) === key)
    // A semester with an incomplete row is already reported above; summing it
    // would produce a second, misleading finding about a total that was never
    // fully written down.
    if (inSem.some((r) => r.min_points == null || r.max_points == null)) continue

    const sumMin = inSem.reduce((n, r) => n + (r.min_points ?? 0), 0)
    const sumMax = inSem.reduce((n, r) => n + (r.max_points ?? 0), 0)
    if (sumMin === BRS_SEMESTER_MIN && sumMax === BRS_SEMESTER_MAX) continue

    findings.push({
      kind: 'semester_total', severity: 'error',
      instrument: null, semester: inSem[0]?.semester ?? null,
      detail: `${semLabel(inSem[0]?.semester ?? null)}: сумма баллов в п.9 — ${sumMin}/${sumMax}, ` +
              `а по положению о БРС за семестр должно набираться ${BRS_SEMESTER_MIN}/${BRS_SEMESTER_MAX}.`,
      recommendation: `Перераспределите баллы между контрольными точками так, чтобы в сумме за семестр ` +
                      `получалось ровно ${BRS_SEMESTER_MIN} минимальных и ${BRS_SEMESTER_MAX} максимальных.`,
    })
  }

  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.length - errors

  let summary: string
  if (errors === 0 && warnings === 0) {
    summary = `П.9 заполнен корректно: по каждому семестру набирается ${BRS_SEMESTER_MIN}/${BRS_SEMESTER_MAX}, ` +
              `у всех контрольных точек указаны баллы. Из него можно собрать ФОС по макету.`
  } else if (errors === 0) {
    summary = `П.9 пригоден для сборки ФОС, но есть замечания: ${warnings}.`
  } else {
    summary = `П.9 пока не годится для сборки ФОС по макету — ошибок: ${errors}` +
              (warnings > 0 ? `, замечаний: ${warnings}.` : '.')
  }

  return { checked: true, ready: errors === 0, findings, summary }
}
