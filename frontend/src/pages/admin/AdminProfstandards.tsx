import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getProfstandards, getProfstandard, extractProfstandardDraft, createProfstandardDraft,
  publishProfstandard, deleteProfstandard, importProfstandardByUrl,
} from '../../api/admin'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { Input } from '../../components/ui/Input'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useUIStore } from '../../store/uiStore'
import type { Profstandard, ProfstandardWithChildren, ProfstandardDraft, ProfstandardOtf } from '../../types'

const PAGE_SIZE = 20

const emptyDraft: ProfstandardDraft = {
  standard: { code: '', name: '' },
  otf: [],
}

/**
 * Профстандарт/ОТФ registry (migration 115, методист feedback item 3) —
 * platform-admin only, mirrors AdminFgos.tsx's upload → extract (no DB
 * write) → editable review screen → confirm/publish flow exactly. Powers
 * the Конструктор's ПК↔ОТФ picker once published.
 */
export default function AdminProfstandards() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [mode, setMode] = useState<'list' | 'review'>('list')
  const [draft, setDraft] = useState<ProfstandardDraft>(emptyDraft)
  const [standardId, setStandardId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-profstandards', page, search],
    queryFn: () => getProfstandards({ page, search: search || undefined }),
  })
  const standards = data?.standards ?? []
  const total     = data?.total ?? 0
  const pages     = Math.ceil(total / PAGE_SIZE)

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setExtracting(true)
    try {
      const extracted = await extractProfstandardDraft(file)
      setDraft(extracted)
      setStandardId(null)
      setMode('review')
    } catch {
      addToast('Не удалось разобрать файл профстандарта', 'error')
    } finally {
      setExtracting(false)
    }
  }

  function toDraft(s: ProfstandardWithChildren): ProfstandardDraft {
    return { standard: { code: s.code, name: s.name }, otf: s.otf }
  }

  async function openStandard(id: string) {
    setOpening(id)
    try {
      const full = await getProfstandard(id)
      setDraft(toDraft(full))
      setStandardId(id)
      setMode('review')
    } catch {
      addToast('Не удалось открыть запись', 'error')
    } finally {
      setOpening(null)
    }
  }

  const publishMut = useMutation({
    mutationFn: async () => {
      const id = standardId ?? (await createProfstandardDraft(draft)).id
      return publishProfstandard(id, draft)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-profstandards'] })
      addToast('Профстандарт опубликован', 'success')
      setMode('list')
      setDraft(emptyDraft)
      setStandardId(null)
    },
    onError: () => addToast('Не удалось опубликовать профстандарт — проверьте обязательные поля', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteProfstandard,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-profstandards'] }),
    onError: () => addToast('Не удалось удалить запись', 'error'),
  })

  function updateStandard(patch: Partial<ProfstandardDraft['standard']>) {
    setDraft((d) => ({ ...d, standard: { ...d.standard, ...patch } }))
  }
  function updateOtf(i: number, patch: Partial<ProfstandardOtf>) {
    setDraft((d) => ({ ...d, otf: d.otf.map((o, idx) => idx === i ? { ...o, ...patch } : o) }))
  }
  function removeOtf(i: number) {
    setDraft((d) => ({ ...d, otf: d.otf.filter((_, idx) => idx !== i) }))
  }
  function addOtf() {
    setDraft((d) => ({
      ...d,
      otf: [...d.otf, { otf_code: '', name: '', qualification_level: null, education_requirement: null, is_verbatim_verified: false, sort_order: d.otf.length }],
    }))
  }

  const canPublish = !!draft.standard.code?.trim() && !!draft.standard.name?.trim()

  if (mode === 'review') {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Проверка профстандарта перед публикацией</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Данные извлечены автоматически — проверьте и исправьте перед публикацией. Ничего не сохраняется, пока вы не нажмёте «Опубликовать».
            </p>
          </div>

          <section className="bg-surface border border-border rounded-lg p-4 space-y-3">
            <h2 className="font-sans text-sm font-semibold text-ink">Профстандарт</h2>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Код" value={draft.standard.code ?? ''}
                onChange={(e) => updateStandard({ code: e.target.value })} placeholder="40.059" />
              <Input label="Наименование" value={draft.standard.name ?? ''}
                onChange={(e) => updateStandard({ name: e.target.value })} placeholder="Промышленный дизайнер" />
            </div>
          </section>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="font-sans text-sm font-semibold text-ink">ОТФ (обобщённые трудовые функции)</h2>
                <p className="text-xs font-sans text-ink-tertiary mt-0.5">
                  Проверьте формулировку каждой ОТФ и уровень образования перед публикацией — они станут источником для проверки ПК-компетенций в Конструкторе.
                </p>
              </div>
              <button onClick={addOtf} className="text-xs font-sans text-amber font-medium hover:underline flex-shrink-0 ml-4">+ добавить ОТФ</button>
            </div>

            {draft.otf.length === 0 ? (
              <p className="text-sm font-sans text-ink-secondary bg-surface border border-border rounded-lg px-4 py-3">
                ОТФ не найдены — добавьте вручную.
              </p>
            ) : (
              <div className="space-y-2.5">
                {draft.otf.map((o, i) => (
                  <div key={i} className="bg-surface border border-border rounded-lg p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-16 flex-shrink-0">
                        <label className="block text-[11px] font-sans font-medium text-ink-tertiary mb-1">Код</label>
                        <input value={o.otf_code} onChange={(e) => updateOtf(i, { otf_code: e.target.value })}
                          placeholder="A"
                          className="w-full text-center text-sm font-mono font-semibold bg-surface-warm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-border-strong" />
                      </div>

                      <span
                        title={o.is_verbatim_verified ? 'Формулировка дословно совпадает с текстом источника' : 'Дословное совпадение не найдено — сверьте формулировку с документом'}
                        className={`mt-5 inline-flex items-center gap-1 flex-shrink-0 text-[10px] font-sans font-semibold uppercase tracking-wide px-2 py-1 rounded-sm ${
                          o.is_verbatim_verified ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                        }`}
                      >
                        {o.is_verbatim_verified ? '✓ Дословно' : '⚠ Проверьте'}
                      </span>

                      <button onClick={() => removeOtf(i)}
                        className="ml-auto mt-5 flex-shrink-0 text-ink-tertiary hover:text-danger transition-colors"
                        title="Удалить ОТФ">×</button>
                    </div>

                    <label className="block text-[11px] font-sans font-medium text-ink-tertiary mb-1">Формулировка ОТФ</label>
                    <textarea value={o.name} rows={2}
                      onChange={(e) => updateOtf(i, { name: e.target.value, is_verbatim_verified: false })}
                      placeholder="Формулировка обобщённой трудовой функции"
                      className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 leading-relaxed resize-y focus:outline-none focus:border-border-strong" />

                    <div className="flex flex-col sm:flex-row gap-3 mt-3">
                      <div className="sm:w-24 flex-shrink-0">
                        <label className="block text-[11px] font-sans font-medium text-ink-tertiary mb-1">Уровень</label>
                        <input value={o.qualification_level ?? ''}
                          onChange={(e) => updateOtf(i, { qualification_level: e.target.value || null })}
                          placeholder="6"
                          className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 focus:outline-none focus:border-border-strong" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[11px] font-sans font-medium text-ink-tertiary mb-1">Требования к образованию</label>
                        <textarea value={o.education_requirement ?? ''} rows={1}
                          onChange={(e) => updateOtf(i, { education_requirement: e.target.value || null })}
                          placeholder="Высшее образование – бакалавриат"
                          className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 leading-relaxed resize-y focus:outline-none focus:border-border-strong" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button loading={publishMut.isPending} disabled={!canPublish} onClick={() => publishMut.mutate()}>
              Опубликовать
            </Button>
            <Button variant="secondary" onClick={() => { setMode('list'); setDraft(emptyDraft); setStandardId(null) }}>
              Отмена
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Профстандарты</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Реестр обобщённых трудовых функций (ОТФ) — источник для проверки формулировок ПК-компетенций в Конструкторе программ.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowUrlImport(true)}>
              Импорт по ссылке
            </Button>
            <CreateButton loading={extracting} onClick={() => document.getElementById('profstandard-file-input')?.click()}>
              Загрузить файл
            </CreateButton>
            <input id="profstandard-file-input" type="file" accept=".pdf,.docx" className="hidden"
              disabled={extracting} onChange={onFilePicked} />
          </div>
        </div>

        {showUrlImport && (
          <UrlImportModal
            onClose={() => setShowUrlImport(false)}
            onImported={() => { qc.invalidateQueries({ queryKey: ['admin-profstandards'] }); setShowUrlImport(false) }}
          />
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Поиск по коду или названию…"
            className="w-full max-w-sm px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
          />
        </div>

        {isLoading ? (
          <p className="text-sm font-sans text-ink-tertiary">Загрузка…</p>
        ) : standards.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-sans text-sm text-ink-secondary mb-1">
              {search ? 'Ничего не найдено.' : 'Реестр пуст.'}
            </p>
            <p className="font-sans text-xs text-ink-tertiary">
              {search ? 'Попробуйте изменить запрос.' : 'Загрузите PDF или Word профстандарта, чтобы добавить первую запись.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {standards.map((s: Profstandard) => (
              <div key={s.id}
                onClick={() => opening === null && void openStandard(s.id)}
                className="bg-surface border border-border rounded-lg p-4 flex items-start justify-between cursor-pointer hover:border-amber/40 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans text-sm font-medium text-ink">{s.code} {s.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${s.status === 'published' ? 'bg-success-bg text-success' : 'bg-surface-warm text-ink-tertiary'}`}>
                      {s.status === 'published' ? 'Опубликован' : 'Черновик'}
                    </span>
                    {opening === s.id && <LoadingSpinner size={12} />}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить «${s.name}»?`)) deleteMut.mutate(s.id) }}
                  className="text-xs text-ink-tertiary hover:text-danger flex-shrink-0 ml-3">Удалить</button>
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4 text-xs font-sans">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 disabled:opacity-40 hover:text-amber">← Назад</button>
            <span className="text-ink-secondary">{page} из {pages} · {total} всего</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 disabled:opacity-40 hover:text-amber">Вперёд →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Single-item import by pasted document link — no bulk-crawl discovery here
// (routes/adminProfstandards.ts's header explains why: the catalog page's
// markup isn't confirmed, so there's no parser to crawl it with yet). Just
// code + name + a link to the PDF/Word file itself.
function UrlImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl]   = useState('')

  const importMut = useMutation({
    mutationFn: () => importProfstandardByUrl({ code, name, url }),
    onSuccess: () => { addToast('Профстандарт импортирован как черновик', 'success'); onImported() },
    onError: () => addToast('Не удалось импортировать — проверьте ссылку', 'error'),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-sans text-sm font-semibold text-ink">Импорт профстандарта по ссылке</h2>
        <Input label="Код" value={code} onChange={(e) => setCode(e.target.value)} placeholder="40.059" />
        <Input label="Наименование" value={name} onChange={(e) => setName(e.target.value)} placeholder="Промышленный дизайнер" />
        <Input label="Ссылка на PDF/Word" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://profstandart.rosmintrud.ru/…" />
        <div className="flex gap-2 pt-1">
          <Button loading={importMut.isPending} disabled={!code || !name || !url} onClick={() => importMut.mutate()}>
            Импортировать
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </div>
  )
}
