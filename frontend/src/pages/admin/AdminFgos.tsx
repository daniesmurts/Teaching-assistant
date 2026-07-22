import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getFgosStandards, getFgosStandard, extractFgosDraft, createFgosDraft, publishFgosStandard, deleteFgosStandard,
} from '../../api/admin'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { Input } from '../../components/ui/Input'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Select from '../../components/ui/Select'
import { useUIStore } from '../../store/uiStore'
import FgosvoImportModal from './FgosvoImportModal'
import type { FgosDraft, FgosStandard, FgosStandardWithChildren, FgosCompetency, FgosStructureRequirement, FgosProfstandardRef } from '../../types'

const LEVEL_LABEL: Record<string, string> = {
  бакалавриат: 'Бакалавриат', магистратура: 'Магистратура', специалитет: 'Специалитет', ординатура: 'Ординатура', аспирантура: 'Аспирантура',
}
// fgosvo.ru's own four ФГОС ВО (3++) categories get distinct colors so a
// long, mixed-level list scans at a glance; аспирантура (outside that
// index, never populated via bulk import) falls back to a neutral tone.
const LEVEL_COLOR: Record<string, string> = {
  бакалавриат: 'bg-amber-light text-amber',
  магистратура: 'bg-info-bg text-info',
  специалитет: 'bg-success-bg text-success',
  ординатура: 'bg-warning-bg text-warning',
}
const LEVEL_COLOR_FALLBACK = 'bg-surface-warm text-ink-tertiary'
const PAGE_SIZE = 20

const emptyDraft: FgosDraft = {
  standard: { direction_code: '', level: 'бакалавриат', title: '', generation: '3++', order_number: null, order_date: null, effective_date: null },
  competencies: [], structureRequirements: [], profstandardRefs: [],
}

/**
 * Feature AA v1 (TODO.md "### AA") — ФГОС 3++ registry, platform-admin only.
 * Upload → extract (no DB write) → editable review screen → confirm/publish.
 * AI never final (rule #3): nothing is persisted until the admin confirms.
 */
export default function AdminFgos() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [mode, setMode] = useState<'list' | 'review'>('list')
  const [draft, setDraft] = useState<FgosDraft>(emptyDraft)
  const [standardId, setStandardId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [showFgosvoImport, setShowFgosvoImport] = useState(false)
  const [search, setSearch]   = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [page, setPage]       = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-fgos', page, search, levelFilter],
    queryFn: () => getFgosStandards({ page, search: search || undefined, level: levelFilter || undefined }),
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
      const extracted = await extractFgosDraft(file)
      setDraft(extracted)
      setStandardId(null)
      setMode('review')
    } catch {
      addToast('Не удалось разобрать файл ФГОС', 'error')
    } finally {
      setExtracting(false)
    }
  }

  function toDraft(s: FgosStandardWithChildren): FgosDraft {
    return {
      standard: {
        direction_code: s.direction_code, level: s.level, title: s.title,
        generation: s.generation, order_number: s.order_number, order_date: s.order_date, effective_date: s.effective_date,
      },
      competencies: s.competencies,
      structureRequirements: s.structure_requirements,
      profstandardRefs: s.profstandard_refs,
    }
  }

  async function openStandard(id: string) {
    setOpening(id)
    try {
      const full = await getFgosStandard(id)
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
      const id = standardId ?? (await createFgosDraft(draft)).id
      return publishFgosStandard(id, draft)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fgos'] })
      addToast('ФГОС опубликован', 'success')
      setMode('list')
      setDraft(emptyDraft)
      setStandardId(null)
    },
    onError: () => addToast('Не удалось опубликовать ФГОС — проверьте обязательные поля', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteFgosStandard,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fgos'] }),
    onError: () => addToast('Не удалось удалить запись', 'error'),
  })

  function updateStandard(patch: Partial<FgosDraft['standard']>) {
    setDraft((d) => ({ ...d, standard: { ...d.standard, ...patch } }))
  }
  function updateCompetency(i: number, patch: Partial<FgosCompetency>) {
    setDraft((d) => ({ ...d, competencies: d.competencies.map((c, idx) => idx === i ? { ...c, ...patch } : c) }))
  }
  function removeCompetency(i: number) {
    setDraft((d) => ({ ...d, competencies: d.competencies.filter((_, idx) => idx !== i) }))
  }
  function addCompetency() {
    setDraft((d) => ({ ...d, competencies: [...d.competencies, { type: 'УК', code: '', formulation: '', is_verbatim_verified: false }] }))
  }
  function updateRequirement(i: number, patch: Partial<FgosStructureRequirement>) {
    setDraft((d) => ({ ...d, structureRequirements: d.structureRequirements.map((r, idx) => idx === i ? { ...r, ...patch } : r) }))
  }
  function removeRequirement(i: number) {
    setDraft((d) => ({ ...d, structureRequirements: d.structureRequirements.filter((_, idx) => idx !== i) }))
  }
  function addRequirement() {
    setDraft((d) => ({ ...d, structureRequirements: [...d.structureRequirements, { block_label: '', min_credits: null, max_credits: null, notes: null }] }))
  }
  function updateRef(i: number, patch: Partial<FgosProfstandardRef>) {
    setDraft((d) => ({ ...d, profstandardRefs: d.profstandardRefs.map((p, idx) => idx === i ? { ...p, ...patch } : p) }))
  }
  function removeRef(i: number) {
    setDraft((d) => ({ ...d, profstandardRefs: d.profstandardRefs.filter((_, idx) => idx !== i) }))
  }
  function addRef() {
    setDraft((d) => ({ ...d, profstandardRefs: [...d.profstandardRefs, { code: '', name: '', source_url: null }] }))
  }

  const canPublish = !!draft.standard.direction_code?.trim() && !!draft.standard.level?.trim() && !!draft.standard.title?.trim()

  // No `w-full` here on purpose: Tailwind's generated stylesheet orders the
  // width-scale utilities (w-20, w-24, ...) before `w-full`, so appending
  // `w-full` to this shared class and then a narrower `w-XX` at each call
  // site doesn't reliably narrow the field — `w-full` wins and the narrow
  // sibling (e.g. the competency code input) gets squeezed to near-zero
  // width instead. Callers that want full width add `w-full` themselves.
  const inputCls = 'px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  if (mode === 'review') {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Проверка ФГОС перед публикацией</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Данные извлечены автоматически — проверьте и исправьте перед публикацией. Ничего не сохраняется, пока вы не нажмёте «Опубликовать».
            </p>
          </div>

          <section className="bg-surface border border-border rounded-lg p-4 space-y-3">
            <h2 className="font-sans text-sm font-semibold text-ink">Стандарт</h2>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Код направления" value={draft.standard.direction_code ?? ''}
                onChange={(e) => updateStandard({ direction_code: e.target.value })} placeholder="09.03.04" />
              <label className="block">
                <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">Уровень</span>
                <select className={inputCls + ' w-full py-2'} value={draft.standard.level ?? ''}
                  onChange={(e) => updateStandard({ level: e.target.value })}>
                  {Object.entries(LEVEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <Input label="Наименование направления" value={draft.standard.title ?? ''}
              onChange={(e) => updateStandard({ title: e.target.value })} placeholder="Программная инженерия" />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Поколение" value={draft.standard.generation ?? ''}
                onChange={(e) => updateStandard({ generation: e.target.value })} placeholder="3++" />
              <Input label="№ приказа" value={draft.standard.order_number ?? ''}
                onChange={(e) => updateStandard({ order_number: e.target.value })} />
              <Input label="Дата приказа" type="date" value={draft.standard.order_date ?? ''}
                onChange={(e) => updateStandard({ order_date: e.target.value })} />
            </div>
          </section>

          <section className="bg-surface border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-sm font-semibold text-ink">УК и ОПК</h2>
              <button onClick={addCompetency} className="text-xs text-amber hover:opacity-80">+ добавить</button>
            </div>
            {draft.competencies.length === 0 && <p className="text-xs font-sans text-ink-tertiary">Компетенции не найдены — добавьте вручную.</p>}
            {draft.competencies.map((c, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-t border-border first:border-t-0">
                <span title={c.is_verbatim_verified ? 'Дословно совпадает с текстом источника' : 'Не найдено дословное совпадение — проверьте формулировку'}
                  className={`flex-shrink-0 mt-2 text-xs ${c.is_verbatim_verified ? 'text-success' : 'text-warning'}`}>
                  {c.is_verbatim_verified ? '✓' : '⚠'}
                </span>
                <select className={inputCls + ' w-20 flex-shrink-0'} value={c.type}
                  onChange={(e) => updateCompetency(i, { type: e.target.value as 'УК' | 'ОПК' })}>
                  <option value="УК">УК</option>
                  <option value="ОПК">ОПК</option>
                </select>
                <input className={inputCls + ' w-24 flex-shrink-0'} value={c.code}
                  onChange={(e) => updateCompetency(i, { code: e.target.value })} placeholder="УК-1" />
                <textarea className={inputCls + ' flex-1 resize-none'} rows={2} value={c.formulation}
                  onChange={(e) => updateCompetency(i, { formulation: e.target.value, is_verbatim_verified: false })} />
                <button onClick={() => removeCompetency(i)} className="flex-shrink-0 mt-1.5 text-ink-tertiary hover:text-danger">×</button>
              </div>
            ))}
          </section>

          <section className="bg-surface border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-sm font-semibold text-ink">Требования к объёму блоков (з.е.)</h2>
              <button onClick={addRequirement} className="text-xs text-amber hover:opacity-80">+ добавить</button>
            </div>
            {draft.structureRequirements.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-t border-border first:border-t-0">
                <input className={inputCls + ' flex-1'} value={r.block_label}
                  onChange={(e) => updateRequirement(i, { block_label: e.target.value })} placeholder="Блок 1. Дисциплины (модули)" />
                <input className={inputCls + ' w-20'} type="number" value={r.min_credits ?? ''}
                  onChange={(e) => updateRequirement(i, { min_credits: e.target.value ? Number(e.target.value) : null })} placeholder="мин" />
                <input className={inputCls + ' w-20'} type="number" value={r.max_credits ?? ''}
                  onChange={(e) => updateRequirement(i, { max_credits: e.target.value ? Number(e.target.value) : null })} placeholder="макс" />
                <button onClick={() => removeRequirement(i)} className="flex-shrink-0 text-ink-tertiary hover:text-danger">×</button>
              </div>
            ))}
          </section>

          <section className="bg-surface border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-sm font-semibold text-ink">Профессиональные стандарты (приложение)</h2>
              <button onClick={addRef} className="text-xs text-amber hover:opacity-80">+ добавить</button>
            </div>
            {draft.profstandardRefs.map((p, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-t border-border first:border-t-0">
                <input className={inputCls + ' w-28 flex-shrink-0'} value={p.code}
                  onChange={(e) => updateRef(i, { code: e.target.value })} placeholder="06.001" />
                <input className={inputCls + ' flex-1'} value={p.name}
                  onChange={(e) => updateRef(i, { name: e.target.value })} placeholder="Наименование профстандарта" />
                <button onClick={() => removeRef(i)} className="flex-shrink-0 text-ink-tertiary hover:text-danger">×</button>
              </div>
            ))}
          </section>

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
            <h1 className="font-display text-2xl font-bold text-ink">ФГОС 3++</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Реестр федеральных образовательных стандартов — общие данные для всех организаций.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowFgosvoImport(true)}>
              Импорт с fgosvo.ru
            </Button>
            <CreateButton loading={extracting} onClick={() => document.getElementById('fgos-file-input')?.click()}>
              Импортировать ФГОС
            </CreateButton>
            <input id="fgos-file-input" type="file" accept=".pdf,.docx" className="hidden"
              disabled={extracting} onChange={onFilePicked} />
          </div>
        </div>

        {showFgosvoImport && (
          <FgosvoImportModal
            onClose={() => setShowFgosvoImport(false)}
            onImported={() => qc.invalidateQueries({ queryKey: ['admin-fgos'] })}
          />
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Поиск по коду или названию направления…"
            className="w-full max-w-sm px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
          />
          <Select
            value={levelFilter}
            onChange={(v) => { setLevelFilter(v); setPage(1) }}
            options={[{ value: '', label: 'Все уровни' }, ...Object.entries(LEVEL_LABEL).map(([v, l]) => ({ value: v, label: l }))]}
            ariaLabel="Фильтр по уровню"
            className="w-48 flex-shrink-0"
          />
        </div>

        {isLoading ? (
          <p className="text-sm font-sans text-ink-tertiary">Загрузка…</p>
        ) : standards.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-sans text-sm text-ink-secondary mb-1">
              {search || levelFilter ? 'Ничего не найдено.' : 'Реестр пуст.'}
            </p>
            <p className="font-sans text-xs text-ink-tertiary">
              {search || levelFilter ? 'Попробуйте изменить запрос или фильтр.' : 'Загрузите PDF или Word ФГОС, чтобы добавить первую запись.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {standards.map((s: FgosStandard) => (
              <div key={s.id}
                onClick={() => opening === null && void openStandard(s.id)}
                className="bg-surface border border-border rounded-lg p-4 flex items-start justify-between cursor-pointer hover:border-amber/40 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans text-sm font-medium text-ink">{s.direction_code} {s.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${LEVEL_COLOR[s.level] ?? LEVEL_COLOR_FALLBACK}`}>{LEVEL_LABEL[s.level] ?? s.level}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${s.status === 'published' ? 'bg-success-bg text-success' : 'bg-surface-warm text-ink-tertiary'}`}>
                      {s.status === 'published' ? 'Опубликован' : 'Черновик'}
                    </span>
                    {opening === s.id && <LoadingSpinner size={12} />}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить «${s.title}»?`)) deleteMut.mutate(s.id) }}
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
