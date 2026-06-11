import { useRef, useState, DragEvent } from 'react'
import { uploadAndWait, type DocumentType, type ProcessingStatus, type DocumentStatus } from '../../api/documents'
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

  return (
    <div>
      <div
        onClick={onClick}
        onDragOver={(e) => { e.preventDefault(); if (!locked) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border border-dashed cursor-pointer transition-colors text-center
          ${dragOver ? 'border-amber bg-amber-light' : 'border-border-mid hover:border-amber/40 hover:bg-surface-warm'}
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
            <span className="text-xl text-ink-tertiary select-none">⤓</span>
            <span className="text-xs font-sans text-ink-secondary">
              Перетащите файл или <span className="text-amber">выберите</span>
            </span>
            <span className="text-[11px] font-sans text-ink-tertiary">
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
    </div>
  )
}
