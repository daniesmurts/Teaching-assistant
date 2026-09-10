import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSatisfaction, type AdminSatisfaction } from '../../api/admin'

// Микро-опросы (TODO Feature AQ, Phase 1). Kept separate from «Отзывы»
// deliberately: that page is unsolicited feedback a teacher chose to send,
// this is a question we interrupted them to ask. Mixing them would make the
// response rate — the number this page exists for — impossible to read.

const FEATURE_LABEL: Record<string, string> = {
  grading:      'Проверка работ',
  presentation: 'Презентации',
}

// Wording is per-feature (the score is not), so the legend has to be too.
const SCORE_LABEL: Record<string, [string, string, string]> = {
  grading:      ['Почти всю', 'Частично', 'Почти не пришлось'],
  presentation: ['Почти все', 'Частично', 'Почти не пришлось'],
}
const GENERIC_LABELS: [string, string, string] = ['Плохо', 'Нормально', 'Хорошо']

const SCORE_CLS = ['bg-danger-bg text-danger', 'bg-warning-bg text-warning', 'bg-success-bg text-success']

const fmt = (d: string) =>
  new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// The log table is four columns of which three are unavoidably wide; the year
// is the one piece a reader can reconstruct, so it goes. Comments above keep
// the full date — there the row is a thing you might quote back to someone.
const fmtShort = (d: string) =>
  new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

function scoreLabel(feature: string, score: number): string {
  return (SCORE_LABEL[feature] ?? GENERIC_LABELS)[score - 1] ?? String(score)
}

/** Shown → answered / dismissed / ignored. Ignored is "shown, then neither" —
 *  the row that a two-table schema would have turned into an absence. */
function tally(rows: AdminSatisfaction[]) {
  const answered = rows.filter((r) => r.responded_at).length
  const dismissed = rows.filter((r) => !r.responded_at && r.dismissed_at).length
  return { shown: rows.length, answered, dismissed, ignored: rows.length - answered - dismissed }
}

export default function AdminSatisfaction() {
  const [feature, setFeature] = useState('')
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin-satisfaction'],
    queryFn:  () => getSatisfaction(300),
  })

  const shown = feature ? rows.filter((r) => r.feature === feature) : rows
  const t = useMemo(() => tally(shown), [shown])

  // The rate that decides whether this mechanism survives. Thresholds are the
  // ones written into TODO Feature AQ's Phase 2 gate — surfaced here rather
  // than left in a file nobody opens while looking at the data.
  const walkAwayPct = pct(t.dismissed + t.ignored, t.shown)
  const gate = walkAwayPct >= 70
    ? { cls: 'text-danger', note: 'Выше 70% — убрать опрос совсем, а не добавлять функции.' }
    : walkAwayPct > 50
      ? { cls: 'text-warning', note: 'Между 50% и 70% — добавлять функции рано, сначала поменять вопрос.' }
      : { cls: 'text-success', note: 'Ниже 50% — можно добавить тесты.' }

  const byFeature = useMemo(() => {
    const map = new Map<string, { counts: [number, number, number]; answered: number }>()
    for (const r of shown) {
      if (!r.score) continue
      const e = map.get(r.feature) ?? { counts: [0, 0, 0] as [number, number, number], answered: 0 }
      e.counts[r.score - 1]++
      e.answered++
      map.set(r.feature, e)
    }
    return [...map.entries()]
  }, [shown])

  const withComments = shown.filter((r) => r.comment)
  const features = [...new Set(rows.map((r) => r.feature))]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Оценки функций</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Микро-опрос после подтверждения оценки или выгрузки презентации</p>
          </div>
          {features.length > 1 && (
            <select
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
            >
              <option value="">Все функции</option>
              {features.map((f) => <option key={f} value={f}>{FEATURE_LABEL[f] ?? f}</option>)}
            </select>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
        ) : t.shown === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📊</div>
            <p className="font-sans text-sm text-ink-secondary">Опросов пока не показывали.</p>
            <p className="font-sans text-xs text-ink-tertiary mt-2">
              Первый появится, когда преподаватель со стажем больше недели подтвердит оценку.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 bg-surface border border-border rounded-lg p-4">
              <h2 className="font-sans text-sm font-semibold text-ink mb-3">Отвечают ли вообще</h2>
              <div className="grid grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Показано',    value: t.shown,     cls: 'text-ink' },
                  { label: 'Ответили',    value: t.answered,  cls: 'text-success' },
                  { label: 'Закрыли',     value: t.dismissed, cls: 'text-warning' },
                  { label: 'Проигнорировали', value: t.ignored, cls: 'text-ink-tertiary' },
                ].map((m) => (
                  <div key={m.label}>
                    <div className={`font-display text-xl font-bold tabular-nums ${m.cls}`}>{m.value}</div>
                    <div className="text-[11px] font-sans text-ink-tertiary">{m.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs font-sans text-ink-secondary">
                Не ответили: <span className={`font-semibold tabular-nums ${gate.cls}`}>{walkAwayPct}%</span> — {gate.note}
              </p>
            </div>

            {byFeature.length > 0 && (
              <div className="mb-6 bg-surface border border-border rounded-lg p-4">
                <h2 className="font-sans text-sm font-semibold text-ink mb-3">Распределение ответов</h2>
                <div className="space-y-3">
                  {byFeature.map(([f, e]) => (
                    <div key={f}>
                      <div className="flex items-center justify-between text-xs font-sans mb-1">
                        <span className="text-ink-secondary">{FEATURE_LABEL[f] ?? f}</span>
                        <span className="text-ink-tertiary tabular-nums">{e.answered} ответов</span>
                      </div>
                      <div className="flex h-5 rounded-md overflow-hidden bg-border/40">
                        {e.counts.map((c, i) => c > 0 && (
                          <div
                            key={i}
                            className={`${['bg-danger', 'bg-warning', 'bg-success'][i]} flex items-center justify-center`}
                            style={{ width: `${pct(c, e.answered)}%` }}
                            title={`${scoreLabel(f, i + 1)}: ${c}`}
                          >
                            <span className="text-[10px] font-sans text-white tabular-nums">{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* A near-unanimous split means the question isn't discriminating —
                    TODO Feature AQ says change the question before adding surfaces. */}
                <p className="text-[11px] font-sans text-ink-tertiary mt-3">
                  Если почти все ответы в одной колонке — вопрос ничего не различает; менять вопрос, а не добавлять функции.
                </p>
              </div>
            )}

            {withComments.length > 0 && (
              <div className="mb-6">
                <h2 className="font-sans text-sm font-semibold text-ink mb-3">
                  С комментарием <span className="text-ink-tertiary font-normal">({withComments.length})</span>
                </h2>
                <div className="space-y-3">
                  {withComments.map((r) => (
                    <div key={r.id} className="bg-surface border border-border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {r.score && (
                          <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm ${SCORE_CLS[r.score - 1]}`}>
                            {scoreLabel(r.feature, r.score)}
                          </span>
                        )}
                        <span className="text-[10px] font-sans px-1.5 py-0.5 rounded-sm bg-info-bg text-info">
                          {FEATURE_LABEL[r.feature] ?? r.feature}
                        </span>
                        <span className="text-xs font-sans text-ink-secondary">
                          {r.teacher_name || r.teacher_email || 'Аноним'}
                          {r.institution_name && <span className="text-ink-tertiary"> · {r.institution_name}</span>}
                        </span>
                        <span className="text-xs font-sans text-ink-tertiary ml-auto">{fmt(r.shown_at)}</span>
                      </div>
                      <p className="text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap">{r.comment}</p>
                      {r.teacher_email && (
                        <a href={`mailto:${r.teacher_email}`} className="text-[11px] font-sans text-amber hover:underline mt-2 inline-block">
                          Ответить
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h2 className="font-sans text-sm font-semibold text-ink mb-3">Все показы</h2>
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm font-sans">
                <thead>
                  <tr className="text-left text-xs text-ink-tertiary border-b border-border">
                    <th className="px-4 py-2">Когда</th>
                    <th className="px-4 py-2">Функция</th>
                    <th className="px-4 py-2">Преподаватель</th>
                    <th className="px-4 py-2">Ответ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-ink-tertiary whitespace-nowrap">{fmtShort(r.shown_at)}</td>
                      <td className="px-4 py-2 text-ink-secondary whitespace-nowrap">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                      <td className="px-4 py-2 text-ink-secondary truncate max-w-[12rem]">
                        {r.teacher_name || r.teacher_email || '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {r.score ? (
                          <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm whitespace-nowrap ${SCORE_CLS[r.score - 1]}`}>
                            {scoreLabel(r.feature, r.score)}
                          </span>
                        ) : r.dismissed_at ? (
                          <span className="text-xs text-ink-tertiary">закрыл</span>
                        ) : (
                          <span className="text-xs text-ink-tertiary">без ответа</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
