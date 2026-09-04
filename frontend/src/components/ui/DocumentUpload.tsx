import { useRef, useState, useEffect, DragEvent } from 'react'
import { uploadAndWait, type DocumentType, type ProcessingStatus, type DocumentStatus } from '../../api/documents'
import { promoteDocumentScope, getDocumentReuseCount } from '../../api/library'
import type { DocumentProvenance, DocumentVisibilityScope } from '../../types'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'

const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png'
const MAX_MB  = 20

const STATUS_LABEL: Record<ProcessingStatus, string> = {
  pending:    'Загрузка…',
  extracting: 'Чтение документа…',
  chunking:   'Индексация содержимого…',
  ready:      'Готово',
  failed:     'Ошибка',
}

interface Props {
  documentType: DocumentType
  courseId?:    string
  onReady?:     (doc: DocumentStatus) => void
  hint?:        string
  /** Defer mode: capture the file without uploading (parent uploads after it has a course id). */
  defer?:       boolean
  onFile?:      (file: File | null) => void
}

export default function DocumentUpload({ documentType, courseId, onReady, hint, defer, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [fileName, setFileName] = useState('')
  const [selected, setSelected] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [readyDoc, setReadyDoc] = useState<DocumentStatus | null>(null)

  const { can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const addToast = useUIStore((s) => s.addToast)

  const locked  = !can('documentUpload')
  const busy    = status !== null && status !== 'ready' && status !== 'failed'

  async function handleFile(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      addToast(`Файл слишком большой (максимум ${MAX_MB} МБ)`, 'error')
      return
    }
    setFileName(file.name)

    // Deferred — capture only; the parent uploads once it has a course id
    if (defer) {
      setSelected(true)
      onFile?.(file)
      return
    }

    try {
      const doc = await uploadAndWait(file, documentType, courseId, setStatus)
      setReadyDoc(doc)
      onReady?.(doc)
    } catch (err) {
      setStatus('failed')
      addToast((err as Error).message || 'Не удалось обработать документ', 'error')
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (locked) { showUpgradeModal('FEATURE_NOT_IN_PLAN'); return }
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onClick() {
    if (locked) { showUpgradeModal('FEATURE_NOT_IN_PLAN'); return }
    inputRef.current?.click()
  }

  // Idle state gets a warm amber-tinted background + larger surface so the
  // dropzone is immediately legible as a target — teachers were scanning
  // past the previous thin-dashed-grey version. Active states (busy / ready /
  // selected) keep their existing minimal look to avoid distracting once the
  // job's underway.
  const idle = !busy && status !== 'ready' && !selected

  return (
    <div>
      <div
        onClick={onClick}
        onDragOver={(e) => { e.preventDefault(); if (!locked) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center
          ${idle ? 'px-6 py-8' : 'px-4 py-5'}
          ${dragOver
            ? 'border-amber bg-amber-light'
            : idle
              ? 'border-amber/40 bg-amber-light/40 hover:border-amber/70 hover:bg-amber-light/70'
              : 'border-border-mid hover:border-amber/40 hover:bg-surface-warm'}
          ${busy ? 'pointer-events-none opacity-70' : ''}`}
      >
        {locked && (
          <span className="absolute top-2 right-2 text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm font-sans font-semibold">
            Pro
          </span>
        )}

        {busy ? (
          <>
            <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-sans text-ink-secondary">{STATUS_LABEL[status!]}</span>
            <span className="text-[11px] font-sans text-ink-tertiary truncate max-w-[200px]">{fileName}</span>
          </>
        ) : status === 'ready' ? (
          <>
            <span className="text-lg">✓</span>
            <span className="text-xs font-sans text-success">Документ обработан</span>
            <span className="text-[11px] font-sans text-ink-tertiary truncate max-w-[200px]">{fileName}</span>
          </>
        ) : selected ? (
          <>
            <span className="text-lg">📎</span>
            <span className="text-xs font-sans text-ink">Файл выбран</span>
            <span className="text-[11px] font-sans text-ink-tertiary truncate max-w-[200px]">{fileName}</span>
            <span className="text-[11px] font-sans text-amber">обработается при создании предмета</span>
          </>
        ) : (
          <>
            {/* Circular icon — gives the eye a clear target before the text
                even registers. SVG so it never falls back to an OS emoji. */}
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-amber text-white mb-1">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4" />
                <path d="M6 10l6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </span>
            <span className="text-sm font-sans font-medium text-ink">
              Перетащите файл сюда
            </span>
            <span className="text-xs font-sans text-ink-secondary">
              или{' '}
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber text-white font-medium">
                выберите файл
              </span>
            </span>
            <span className="text-[11px] font-sans text-ink-tertiary mt-1">
              {hint ?? 'PDF, Word или изображение · до 20 МБ'}
            </span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      {status === 'ready' && readyDoc && (documentType === 'material' || documentType === 'syllabus') && (
        <SharePrompt doc={readyDoc} />
      )}
    </div>
  )
}

// ─── Feature AN — «Поделиться с кафедрой» ───────────────────────────────────
//
// Inline promotion control for a just-uploaded material/syllabus. Deliberately
// simple: scope_unit_id defaults server-side to the teacher's own primary
// department (routes/documents.ts), so this never needs an org-unit picker —
// the common case is "share what I just uploaded with my own кафедра".
// Institution-wide sharing is offered too, gated the same way the backend
// gates it (Institution plan tier) — a rejected attempt just surfaces the
// server's error rather than trying to duplicate that gate here.
const PROVENANCE_OPTIONS: { value: DocumentProvenance; label: string; hint: string }[] = [
  { value: 'own_work',         label: 'Моя собственная разработка', hint: 'вы автор или составитель материала' },
  { value: 'open_licence',      label: 'Открытая лицензия',          hint: 'материал распространяется свободно (Creative Commons и т.п.)' },
  { value: 'institution_owned', label: 'Собственность заведения',    hint: 'методичка/материал, изданный вашим учебным заведением' },
  { value: 'unknown',           label: 'Не уверен(а)',               hint: 'происхождение не установлено — будет доступно только внутри заведения' },
]

// Exported so CourseMaterials.tsx can reuse the exact same share control for
// an already-uploaded material listed there, not just a freshly-uploaded one
// — same UI/behaviour either way. Takes the minimal shape it actually reads
// (id + visibilityScope) rather than the full DocumentStatus, so both that
// type and api/documents.ts's MaterialListItem satisfy it structurally.
export function SharePrompt({ doc }: { doc: { id: string; visibilityScope?: DocumentVisibilityScope } }) {
  const addToast = useUIStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<'unit' | 'institution'>('unit')
  const [provenance, setProvenance] = useState<DocumentProvenance>('own_work')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'unit' | 'institution' | null>(
    doc.visibilityScope === 'unit' || doc.visibilityScope === 'institution' ? doc.visibilityScope : null
  )
  const [reuseCount, setReuseCount] = useState<number | null>(null)

  useEffect(() => {
    if (!done) return
    getDocumentReuseCount(doc.id).then(setReuseCount).catch(() => null)
  }, [done, doc.id])

  async function revoke() {
    setBusy(true)
    try {
      await promoteDocumentScope(doc.id, { visibility_scope: 'course' })
      setDone(null)
      addToast('Материал больше не общий — снова доступен только этому предмету', 'success')
    } catch (err) {
      addToast((err as Error).message || 'Не удалось изменить область видимости', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-2 text-[11px] font-sans text-ink-tertiary">
        Материал доступен {done === 'unit' ? 'кафедре' : 'всему учебному заведению'}.
        {reuseCount !== null && reuseCount > 0 && (
          <> Использован за пределами предмета {reuseCount} раз.</>
        )}{' '}
        <button type="button" onClick={revoke} disabled={busy} className="text-amber hover:underline disabled:opacity-60">
          {busy ? 'Сохранение…' : 'Вернуть только предмету'}
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-[11px] font-sans text-amber hover:underline"
      >
        Поделиться с кафедрой
      </button>
    )
  }

  async function submit() {
    setBusy(true)
    try {
      const result = await promoteDocumentScope(doc.id, { visibility_scope: target, provenance })
      setDone(result.visibilityScope === 'unit' || result.visibilityScope === 'institution' ? result.visibilityScope : null)
      addToast('Материал добавлен в библиотеку', 'success')
    } catch (err) {
      addToast((err as Error).message || 'Не удалось поделиться материалом', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 p-3 rounded-lg border border-border bg-surface-warm text-left">
      <div className="text-[11px] font-sans font-medium text-ink mb-2">Область видимости</div>
      <div className="flex gap-2 mb-3">
        <ScopeOption label="Кафедра" active={target === 'unit'} onClick={() => setTarget('unit')} />
        <ScopeOption label="Учебное заведение" active={target === 'institution'} onClick={() => setTarget('institution')} />
      </div>

      <div className="text-[11px] font-sans font-medium text-ink mb-1.5">Происхождение материала</div>
      <div className="space-y-1 mb-3">
        {PROVENANCE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-2 text-[11px] font-sans cursor-pointer">
            <input
              type="radio"
              name={`provenance-${doc.id}`}
              checked={provenance === opt.value}
              onChange={() => setProvenance(opt.value)}
              className="mt-0.5"
            />
            <span>
              <span className="text-ink">{opt.label}</span>{' '}
              <span className="text-ink-tertiary">— {opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="text-[11px] font-sans font-medium px-2.5 py-1 rounded-md bg-amber text-white disabled:opacity-60"
        >
          {busy ? 'Сохранение…' : 'Поделиться'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-[11px] font-sans px-2.5 py-1 rounded-md text-ink-secondary hover:bg-surface"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

function ScopeOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] font-sans px-2.5 py-1 rounded-md border ${
        active ? 'border-amber bg-amber-light text-amber font-medium' : 'border-border text-ink-secondary hover:bg-surface'
      }`}
    >
      {label}
    </button>
  )
}
