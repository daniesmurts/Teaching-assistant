import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../store/uiStore'
import { discoverFgosvo, importFgosvoItem, type FgosvoDiscoverItem, type FgosvoDiscoverResult } from '../../api/admin'
import LoadingSpinner from '../../components/ui/LoadingSpinner'

// Bulk ФГОС import from fgosvo.ru (extends TODO Feature AA): paste the top
// listing URL once (e.g. https://fgosvo.ru/fgosvo/index/24 for bachelor's) →
// server crawls every subject-area category linked from it → user confirms
// a checklist → each confirmed standard is fetched, extracted, and landed as
// a DRAFT (never auto-published — rule #3; too many to hand-review at
// import time, the admin reviews/publishes each one later from the list).
// Same client-driven import loop as SvedenImportModal.tsx: progress and
// per-item retry come free, no new job infrastructure needed.

type Phase = 'input' | 'discovering' | 'checklist' | 'importing' | 'done'

const LEVEL_LABEL: Record<string, string> = {
  бакалавриат: 'Бакалавриат', магистратура: 'Магистратура', специалитет: 'Специалитет', ординатура: 'Ординатура', аспирантура: 'Аспирантура',
}
const LEVEL_OPTIONS = Object.keys(LEVEL_LABEL)

interface ItemState extends FgosvoDiscoverItem {
  checked: boolean
  level:   string | null
}

export default function FgosvoImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState('https://fgosvo.ru/fgosvo/index/24')
  const [result, setResult] = useState<FgosvoDiscoverResult | null>(null)
  const [items, setItems] = useState<ItemState[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [failures, setFailures] = useState<{ text: string }[]>([])
  const [importedCount, setImportedCount] = useState(0)

  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const prev = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.left = prev.left
      body.style.right = prev.right
      body.style.width = prev.width
      window.scrollTo(0, scrollY)
    }
  }, [])

  async function discover() {
    if (!url.trim()) { addToast('Вставьте ссылку на страницу списка ФГОС', 'error'); return }
    setPhase('discovering')
    try {
      const res = await discoverFgosvo(url.trim())
      setResult(res)
      setItems(res.items.map((it) => ({ ...it, checked: !it.already_imported && !!it.code, level: it.level })))
      setPhase('checklist')
    } catch {
      setPhase('input')   // toast handled by the axios interceptor
    }
  }

  function setItem(idx: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const selected = items.filter((it) => it.checked && !!it.code && !!it.name && !!it.level)

  const grouped = useMemo(() => {
    const map = new Map<string, ItemState[]>()
    for (const it of items) {
      const list = map.get(it.category) ?? []
      list.push(it)
      map.set(it.category, list)
    }
    return [...map.entries()]
  }, [items])

  async function runImport() {
    setPhase('importing')
    setFailures([])
    let ok = 0
    for (let i = 0; i < selected.length; i++) {
      const it = selected[i]
      setProgress({ current: i + 1, total: selected.length, label: `${it.code} ${it.name}` })
      try {
        await importFgosvoItem({ code: it.code!, name: it.name!, level: it.level!, pdfUrl: it.pdf_url })
        ok++
      } catch {
        setFailures((prev) => [...prev, { text: `${it.code} ${it.name}` }])
      }
    }
    setImportedCount(ok)
    setPhase('done')
    if (ok > 0) onImported()
  }

  const busy = phase === 'discovering' || phase === 'importing'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />

      <div className="relative bg-surface rounded-xl border border-border max-w-2xl w-full p-6 animate-[resultAppear_250ms_ease_forwards] max-h-[85vh] flex flex-col">
        <button onClick={onClose} disabled={busy}
          className="absolute top-4 right-4 text-ink-tertiary hover:text-ink transition-colors text-lg leading-none disabled:opacity-40">×</button>

        <h2 className="font-display text-xl font-bold text-ink mb-1">Импорт с fgosvo.ru</h2>

        {(phase === 'input' || phase === 'discovering') && (
          <>
            <p className="font-sans text-sm text-ink-secondary mb-4">
              Вставьте ссылку на страницу списка ФГОС ВО (3++) на fgosvo.ru — например, страницу
              направлений бакалавриата, магистратуры или специалитета. ИСПУМ обойдёт все категории
              на странице и найдёт документы всех направлений.
            </p>
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void discover() }}
              placeholder="https://fgosvo.ru/fgosvo/index/24"
              disabled={phase === 'discovering'}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas font-sans text-sm text-ink placeholder:text-ink-tertiary focus:outline-none focus:border-amber"
            />
            <button onClick={() => void discover()} disabled={phase === 'discovering'}
              className="mt-4 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2">
              {phase === 'discovering' && <LoadingSpinner size={16} />}
              {phase === 'discovering' ? 'Обходим категории на fgosvo.ru…' : 'Найти документы'}
            </button>
            {phase === 'discovering' && (
              <div className="mt-4">
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-amber rounded-full animate-[svedenIndeterminate_1.4s_ease-in-out_infinite]" />
                </div>
                <p className="mt-2 text-xs font-sans text-ink-tertiary">
                  Обходим десятки страниц категорий по очереди — это может занять минуту.
                </p>
              </div>
            )}
          </>
        )}

        {phase === 'checklist' && result && (
          <>
            <p className="font-sans text-sm text-ink-secondary mb-3">
              Найдено {items.length} направлений в {result.categories_scanned} категориях
              {result.level && <> · уровень: <span className="text-ink font-medium">{LEVEL_LABEL[result.level] ?? result.level}</span></>}.
              Уже зарегистрированные направления не отмечены — отметьте, что импортировать.
            </p>
            {result.categories_failed.length > 0 && (
              <p className="font-sans text-xs text-warning mb-3">
                Не удалось обработать {result.categories_failed.length} категорий: {result.categories_failed.map((c) => c.title).join(', ')}.
              </p>
            )}

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
              {grouped.map(([category, categoryItems]) => (
                <div key={category}>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    {category} · {categoryItems.length}
                  </div>
                  <div className="space-y-1.5">
                    {categoryItems.map((it) => {
                      const idx = items.indexOf(it)
                      return (
                        <label key={`${it.code}-${it.pdf_url}`} className="flex items-center gap-2.5 text-sm font-sans text-ink bg-canvas border border-border rounded-lg px-3 py-2 cursor-pointer">
                          <input type="checkbox" checked={it.checked} disabled={!it.code || !it.name}
                            onChange={(e) => setItem(idx, { checked: e.target.checked })}
                            className="accent-amber flex-shrink-0" />
                          <span className="flex-shrink-0 text-ink-tertiary text-xs w-20">{it.code ?? '—'}</span>
                          <span className="flex-1 min-w-0 truncate" title={it.name ?? ''}>{it.name ?? 'без названия'}</span>
                          {it.already_imported && <span className="text-xs text-ink-tertiary flex-shrink-0">уже в реестре</span>}
                          <select value={it.level ?? ''} onClick={(e) => e.preventDefault()}
                            onChange={(e) => setItem(idx, { level: e.target.value || null })}
                            className="text-xs font-sans bg-surface border border-border rounded px-1.5 py-1 text-ink flex-shrink-0">
                            <option value="">— уровень —</option>
                            {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                          </select>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-sm font-sans text-ink-secondary">На странице не найдено направлений.</p>
              )}
            </div>

            <button onClick={() => void runImport()} disabled={selected.length === 0}
              className="mt-4 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60">
              Импортировать выбранные · {selected.length}
            </button>
          </>
        )}

        {phase === 'importing' && (
          <div className="py-6">
            <p className="font-sans text-sm text-ink mb-2">Импортируем {progress.current} из {progress.total}…</p>
            <p className="font-sans text-xs text-ink-secondary truncate mb-3">{progress.label}</p>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-amber transition-all" style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }} />
            </div>
            <p className="font-sans text-xs text-ink-tertiary mt-3">
              Каждый файл скачивается и обрабатывается — это может занять много минут для большого списка.
              Не закрывайте окно до завершения.
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="py-4">
            <p className="font-sans text-sm text-ink mb-2">
              Импортировано (черновики): <span className="font-medium">{importedCount}</span>
              {failures.length > 0 && <> · не удалось: <span className="font-medium text-danger">{failures.length}</span></>}
            </p>
            <p className="font-sans text-xs text-ink-tertiary mb-3">
              Ничего не опубликовано — откройте каждую запись из списка, проверьте и опубликуйте.
            </p>
            {failures.length > 0 && (
              <ul className="text-xs font-sans text-ink-secondary space-y-1 mb-3 max-h-40 overflow-y-auto">
                {failures.map((f, i) => <li key={i}>· {f.text}</li>)}
              </ul>
            )}
            <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity">Готово</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
