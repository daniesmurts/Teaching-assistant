import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../store/uiStore'
import {
  discoverProgramDocuments, uploadProgramDocument,
  type SvedenDiscoverResult, type SvedenDiscoveredItem,
} from '../../api/programs'
import type { ProgramDiscipline, ProgramPracticeType } from '../../types'
import { PROGRAM_PRACTICE_TYPES, PROGRAM_PRACTICE_LABEL } from '../../types'
import LoadingSpinner from '../ui/LoadingSpinner'

// Bulk РПД import from the university's mandated «Сведения об образовательной
// организации → Образование» page (Feature AD): paste the page URL once →
// server parses the disclosure table's microdata → user confirms a checklist →
// each confirmed link is imported through the existing per-document endpoint,
// sequentially, with per-item progress. The import loop lives client-side on
// purpose: progress and per-item retry come free, and closing the modal
// mid-run simply leaves the already-imported documents in place (re-running
// discovery skips/supersedes idempotently).

type Phase = 'input' | 'discovering' | 'checklist' | 'importing' | 'done'

interface ItemState extends SvedenDiscoveredItem {
  checked:        boolean
  // User-adjustable copies (the server's values are only suggestions).
  disciplineId:   string | null
  practiceType:   ProgramPracticeType | null
}

export default function SvedenImportModal({
  programId, disciplines, onClose, onImported,
}: {
  programId:   string
  disciplines: ProgramDiscipline[]
  onClose:     () => void
  onImported:  () => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [phase, setPhase]     = useState<Phase>('input')
  const [pageUrl, setPageUrl] = useState('')
  const [result, setResult]   = useState<SvedenDiscoverResult | null>(null)
  const [items, setItems]     = useState<ItemState[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [failures, setFailures] = useState<{ text: string }[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)

  // Real sveden pages can take 2+ minutes to generate server-side (a pilot
  // university's own on-page banner warns "please wait" for this exact
  // reason) — a static "Ищем документы…" label with nothing moving for two
  // minutes reads as broken. Tick a visible elapsed-time counter so the wait
  // has ongoing, honest feedback instead of a single frozen line.
  useEffect(() => {
    if (phase !== 'discovering') { setElapsedSec(0); return }
    const start = Date.now()
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Lock background scroll while open. Plain `overflow: hidden` on body is
  // NOT reliable on iOS/mobile Safari — it doesn't actually stop touch
  // scrolling, and worse, it can desync `position: fixed` descendants from
  // the true visual viewport (the modal ends up pinned to whatever scroll
  // offset the page happened to be at when the lock engaged, instead of
  // centering on the current viewport — exactly the "modal not visible
  // unless I'd already scrolled to where it is" symptom on a long page).
  // The reliable cross-browser technique: pin body itself with `position:
  // fixed` at the current scroll offset, then restore + re-scroll on close.
  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const prev = {
      position: body.style.position, top: body.style.top,
      left: body.style.left, right: body.style.right, width: body.style.width,
    }
    body.style.position = 'fixed'
    body.style.top   = `-${scrollY}px`
    body.style.left  = '0'
    body.style.right = '0'
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top      = prev.top
      body.style.left     = prev.left
      body.style.right    = prev.right
      body.style.width    = prev.width
      window.scrollTo(0, scrollY)
    }
  }, [])

  const disciplineOptions = useMemo(
    () => disciplines.filter((d): d is ProgramDiscipline & { id: string } => !!d.id),
    [disciplines],
  )

  async function discover(year?: string) {
    if (!pageUrl.trim()) { addToast('Вставьте ссылку на страницу «Сведения → Образование»', 'error'); return }
    setPhase('discovering')
    try {
      const res = await discoverProgramDocuments(programId, pageUrl.trim(), year)
      setResult(res)
      setItems(res.items.map((it) => ({
        ...it,
        // Default-checked only when import can proceed without a manual pick
        // AND wouldn't silently replace an existing file.
        checked:      !it.has_current_doc && (it.kind === 'practice' ? !!it.practice_type : !!it.discipline_id),
        disciplineId: it.discipline_id,
        practiceType: it.practice_type,
      })))
      setPhase('checklist')
    } catch {
      setPhase('input')   // toast handled by the axios interceptor
    }
  }

  function setItem(idx: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const selected = items.filter((it) =>
    it.checked && (it.kind === 'working_programme' ? !!it.disciplineId : !!it.practiceType))

  async function runImport() {
    setPhase('importing')
    setFailures([])
    let ok = 0
    for (let i = 0; i < selected.length; i++) {
      const it = selected[i]
      setProgress({ current: i + 1, total: selected.length, label: it.text })
      try {
        await uploadProgramDocument(programId, it.kind === 'working_programme'
          ? { fileUrl: it.url, kind: 'working_programme', disciplineId: it.disciplineId }
          : { fileUrl: it.url, kind: 'practice', practiceType: it.practiceType })
        ok++
      } catch {
        // The interceptor already toasts the specific reason; keep the item in
        // the summary so the user knows which ones to retry by hand.
        setFailures((prev) => [...prev, { text: it.text }])
      }
    }
    setImportedCount(ok)
    setPhase('done')
    if (ok > 0) onImported()
  }

  const busy = phase === 'discovering' || phase === 'importing'
  const rpdItems      = items.filter((it) => it.kind === 'working_programme')
  const practiceItems = items.filter((it) => it.kind === 'practice')

  // Rendered through a portal directly under <body> — a deeply nested modal
  // whose `fixed` positioning depends on no ancestor ever gaining a
  // transform/filter/contain (any future refactor upstream could silently
  // break that) is too fragile to rely on. The portal makes this modal a
  // sibling of the whole app instead of a descendant of the page it opens
  // from, which is the standard fix real modal libraries use for exactly
  // this class of bug — it can no longer be pulled off-viewport by anything
  // in the page tree, whatever the cause turns out to be.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />

      <div className="relative bg-surface rounded-xl border border-border max-w-2xl w-full p-6 animate-[resultAppear_250ms_ease_forwards] max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          disabled={busy}
          className="absolute top-4 right-4 text-ink-tertiary hover:text-ink transition-colors text-lg leading-none disabled:opacity-40"
        >
          ×
        </button>

        <h2 className="font-display text-xl font-bold text-ink mb-1">Импорт со страницы сведений</h2>

        {(phase === 'input' || phase === 'discovering') && (
          <>
            <p className="font-sans text-sm text-ink-secondary mb-4">
              Вставьте ссылку на страницу «Сведения об образовательной организации → Образование»
              сайта вуза (обычно она находится по адресу <span className="font-mono text-xs">/sveden/education</span>).
              ИСПУМ найдёт в таблице строку этой программы и предложит загрузить все РПД и практики разом.
            </p>
            <input
              type="url"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void discover() }}
              placeholder="https://www.университет.рф/sveden/education"
              disabled={phase === 'discovering'}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas font-sans text-sm text-ink placeholder:text-ink-tertiary focus:outline-none focus:border-amber"
            />
            <button
              onClick={() => void discover()}
              disabled={phase === 'discovering'}
              className="mt-4 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {phase === 'discovering' && <LoadingSpinner size={16} />}
              {phase === 'discovering' ? 'Ищем документы на странице…' : 'Найти документы'}
            </button>
            {phase === 'discovering' && (
              <div className="mt-4">
                {/* Indeterminate — we have no real percentage from a single
                    request, so this signals "still working", not progress. */}
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-amber rounded-full animate-[svedenIndeterminate_1.4s_ease-in-out_infinite]" />
                </div>
                <p className="mt-2 text-xs font-sans text-ink-tertiary">
                  Прошло: {formatElapsed(elapsedSec)}. Страницы сведений некоторых вузов
                  формируются медленно (иногда несколько минут на большой программе за много
                  лет) — это нормально, дождитесь загрузки, не закрывайте окно.
                </p>
              </div>
            )}
          </>
        )}

        {phase === 'checklist' && result && (
          result.matched ? (
            <>
              <div className="mb-3">
                <p className="font-sans text-sm text-ink-secondary">
                  Найдена программа{' '}
                  <span className="text-ink font-medium">
                    {[result.matched.code, result.matched.name].filter(Boolean).join(' ')}
                  </span>
                  {result.matched.profile && result.matched.profile !== result.matched.name && (
                    <> · профиль <span className="text-ink font-medium">{result.matched.profile}</span></>
                  )}
                  {' '}· отметьте, что загрузить.
                </p>
                {result.available_years.length > 1 && (
                  <p className="font-sans text-xs text-ink-tertiary mt-1">
                    Показан год:{' '}
                    <select
                      value={result.selected_year ?? ''}
                      onChange={(e) => void discover(e.target.value)}
                      className="bg-surface border border-border rounded px-1.5 py-0.5 text-ink text-xs"
                    >
                      {result.available_years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    {' '}— на странице сведений есть несколько лет, выберите другой при необходимости.
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
                {rpdItems.length > 0 && (
                  <div>
                    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                      Рабочие программы · {rpdItems.length}
                    </div>
                    <div className="space-y-1.5">
                      {rpdItems.map((it) => {
                        const idx = items.indexOf(it)
                        return (
                          <label key={it.url} className="flex items-center gap-2.5 text-sm font-sans text-ink bg-canvas border border-border rounded-lg px-3 py-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={it.checked}
                              onChange={(e) => setItem(idx, { checked: e.target.checked })}
                              className="accent-amber flex-shrink-0"
                            />
                            <span className="flex-1 min-w-0 truncate" title={it.text}>{it.text}</span>
                            {it.disciplineId ? (
                              <span className="text-xs text-ink-tertiary flex-shrink-0">
                                {it.match_confidence === 'fuzzy' ? '≈ ' : ''}
                                {disciplineOptions.find((d) => d.id === it.disciplineId)?.name ?? ''}
                                {it.has_current_doc ? ' · заменит текущий файл' : ''}
                              </span>
                            ) : (
                              <select
                                value={it.disciplineId ?? ''}
                                onClick={(e) => e.preventDefault()}
                                onChange={(e) => setItem(idx, { disciplineId: e.target.value || null, checked: !!e.target.value })}
                                className="text-xs font-sans bg-surface border border-border rounded px-1.5 py-1 text-ink max-w-[180px] flex-shrink-0"
                              >
                                <option value="">— дисциплина —</option>
                                {disciplineOptions.map((d) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                {practiceItems.length > 0 && (
                  <div>
                    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                      Практики · {practiceItems.length}
                    </div>
                    <div className="space-y-1.5">
                      {practiceItems.map((it) => {
                        const idx = items.indexOf(it)
                        return (
                          <label key={it.url} className="flex items-center gap-2.5 text-sm font-sans text-ink bg-canvas border border-border rounded-lg px-3 py-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={it.checked}
                              onChange={(e) => setItem(idx, { checked: e.target.checked })}
                              className="accent-amber flex-shrink-0"
                            />
                            <span className="flex-1 min-w-0 truncate" title={it.text}>{it.text}</span>
                            <select
                              value={it.practiceType ?? ''}
                              onClick={(e) => e.preventDefault()}
                              onChange={(e) => setItem(idx, {
                                practiceType: (e.target.value || null) as ProgramPracticeType | null,
                                checked: !!e.target.value,
                              })}
                              className="text-xs font-sans bg-surface border border-border rounded px-1.5 py-1 text-ink max-w-[220px] flex-shrink-0"
                            >
                              <option value="">— тип практики —</option>
                              {PROGRAM_PRACTICE_TYPES.map((t) => (
                                <option key={t} value={t}>{PROGRAM_PRACTICE_LABEL[t]}</option>
                              ))}
                            </select>
                            {it.has_current_doc && (
                              <span className="text-xs text-ink-tertiary flex-shrink-0">заменит текущий</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                {items.length === 0 && (
                  <p className="text-sm font-sans text-ink-secondary">
                    В строке программы не найдено РПД или практик для загрузки.
                  </p>
                )}
              </div>

              {Object.keys(result.skipped).length > 0 && (
                <p className="text-xs font-sans text-ink-tertiary mt-3">
                  Не импортируются здесь: учебный план, описание ОП, графики и аннотации — они
                  пропущены ({Object.values(result.skipped).reduce((a, b) => a + b, 0)}).
                </p>
              )}

              <button
                onClick={() => void runImport()}
                disabled={selected.length === 0}
                className="mt-4 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                Загрузить выбранные · {selected.length}
              </button>
            </>
          ) : (
            <>
              <p className="font-sans text-sm text-ink-secondary mb-1">
                Не удалось однозначно определить строку этой программы на странице. Либо у
                программы не указан код направления (например, 09.03.03) — он используется для
                поиска, либо на странице несколько строк с этим кодом и именем для разных
                профилей, и по названию программы в ИСПУМ не получилось выбрать нужную. Найденные
                на странице программы:
              </p>
              {result.available_years.length > 1 && (
                <p className="font-sans text-xs text-ink-tertiary mb-3">
                  Показан год:{' '}
                  <select
                    value={result.selected_year ?? ''}
                    onChange={(e) => void discover(e.target.value)}
                    className="bg-surface border border-border rounded px-1.5 py-0.5 text-ink text-xs"
                  >
                    {result.available_years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {' '}— попробуйте другой год, если нужной программы здесь нет.
                </p>
              )}
              <div className="flex-1 overflow-y-auto min-h-0">
                <ul className="space-y-1 text-sm font-sans text-ink">
                  {result.candidates.map((c, i) => (
                    <li key={i} className="bg-canvas border border-border rounded-lg px-3 py-2">
                      {[c.code, c.name].filter(Boolean).join(' — ') || 'Без названия'}
                      {c.profile && c.profile !== c.name && (
                        <span className="text-ink-secondary"> · профиль: {c.profile}</span>
                      )}
                      {' '}<span className="text-ink-tertiary text-xs">· документов: {c.doc_count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => setPhase('input')}
                className="mt-4 w-full py-2.5 rounded-lg border border-border font-sans text-sm text-ink hover:border-amber/40 transition-colors"
              >
                Вставить другую ссылку
              </button>
            </>
          )
        )}

        {phase === 'importing' && (
          <div className="py-6">
            <p className="font-sans text-sm text-ink mb-2">
              Загружаем {progress.current} из {progress.total}…
            </p>
            <p className="font-sans text-xs text-ink-secondary truncate mb-3">{progress.label}</p>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-amber transition-all"
                style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
              />
            </div>
            <p className="font-sans text-xs text-ink-tertiary mt-3">
              Каждый файл скачивается с сайта вуза и обрабатывается — это может занять несколько минут.
              Не закрывайте окно до завершения.
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="py-4">
            <p className="font-sans text-sm text-ink mb-2">
              Загружено: <span className="font-medium">{importedCount}</span>
              {failures.length > 0 && <> · не удалось: <span className="font-medium text-danger">{failures.length}</span></>}
            </p>
            {failures.length > 0 && (
              <ul className="text-xs font-sans text-ink-secondary space-y-1 mb-3 max-h-40 overflow-y-auto">
                {failures.map((f, i) => <li key={i}>· {f.text}</li>)}
              </ul>
            )}
            <button
              onClick={onClose}
              className="mt-2 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Готово
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m} мин ${String(s).padStart(2, '0')} сек` : `${s} сек`
}
