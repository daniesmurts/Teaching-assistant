import { useEffect, useRef, useState } from 'react'
import { uploadAndWait, type ProcessingStatus } from '../../api/documents'
import { useUIStore } from '../../store/uiStore'

const ACCEPT  = '.pdf,.jpg,.jpeg,.png'
const MAX_MB  = 20
const MAX_FILES = 6

interface DrawingItem {
  id:            string   // local key, not a server id
  fileName:      string
  status:        ProcessingStatus | 'uploading'
  extractedText: string | null
  error?:        string
}

interface Props {
  onChange: (drawings: Array<{ file_name: string; extracted_text: string }>) => void
}

/**
 * Multi-file чертежи upload for the ВКР long-review flow (TODO Feature N).
 * Each file goes through the existing /api/documents/upload → OCR pipeline
 * (document_type "assignment" — same as the main submission upload, just not
 * fed into submission_text). Ready files are reported up as
 * {file_name, extracted_text} pairs for the review request payload.
 */
export default function DrawingsUpload({ onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<DrawingItem[]>([])
  const addToast = useUIStore((s) => s.addToast)

  // Derive the ready-only payload whenever the item list changes, rather
  // than trying to call onChange from inside a setItems updater (circular
  // and unsafe under React StrictMode's double-invoke).
  useEffect(() => {
    onChange(
      items
        .filter((d) => d.status === 'ready' && d.extractedText)
        .map((d) => ({ file_name: d.fileName, extracted_text: d.extractedText! }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  async function addFiles(files: FileList) {
    const room = MAX_FILES - items.length
    if (room <= 0) {
      addToast(`Можно приложить не более ${MAX_FILES} чертежей`, 'error')
      return
    }
    const picked = Array.from(files).slice(0, room)

    for (const file of picked) {
      if (file.size > MAX_MB * 1024 * 1024) {
        addToast(`«${file.name}» слишком большой (максимум ${MAX_MB} МБ)`, 'error')
        continue
      }
      const id = `${file.name}-${Date.now()}-${Math.random()}`
      setItems((prev) => [...prev, { id, fileName: file.name, status: 'uploading', extractedText: null }])

      try {
        const doc = await uploadAndWait(file, 'assignment', undefined, (status) => {
          setItems((prev) => prev.map((d) => d.id === id ? { ...d, status } : d))
        })
        setItems((prev) => prev.map((d) => d.id === id
          ? { ...d, status: 'ready' as const, extractedText: doc.extractedText }
          : d))
      } catch (err) {
        setItems((prev) => prev.map((d) => d.id === id
          ? { ...d, status: 'failed' as const, error: (err as Error).message || 'Не удалось обработать файл' }
          : d))
      }
    }
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((d) => d.id !== id))
  }

  const STATUS_LABEL: Record<DrawingItem['status'], string> = {
    pending:    'В очереди…',
    uploading:  'Загрузка…',
    extracting: 'Распознаём…',
    chunking:   'Распознаём…',
    ready:      'Готово',
    failed:     'Ошибка',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-sans font-medium text-ink">Чертежи (опционально)</span>
        {items.length < MAX_FILES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-sans font-medium text-amber hover:opacity-80"
          >
            + Добавить чертёж
          </button>
        )}
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary mb-2 leading-relaxed">
        Приложите чертежи (PDF или фото), упомянутые в работе — рецензия сверит размеры и обозначения на чертеже с текстом ПЗ.
      </p>

      {items.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {items.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-warm border border-border rounded-md">
              {(d.status === 'uploading' || d.status === 'extracting' || d.status === 'chunking' || d.status === 'pending') && (
                <div className="w-3 h-3 border-2 border-amber border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
              {d.status === 'ready'  && <span className="text-success text-sm flex-shrink-0">✓</span>}
              {d.status === 'failed' && <span className="text-danger text-sm flex-shrink-0">⚠</span>}
              <span className="flex-1 text-xs font-sans text-ink truncate">{d.fileName}</span>
              <span className={`text-[10px] font-sans flex-shrink-0 ${d.status === 'failed' ? 'text-danger' : 'text-ink-tertiary'}`}>
                {d.status === 'failed' ? (d.error ?? STATUS_LABEL.failed) : STATUS_LABEL[d.status]}
              </span>
              <button
                type="button"
                onClick={() => remove(d.id)}
                className="text-ink-tertiary hover:text-danger text-sm leading-none flex-shrink-0"
                title="Убрать"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
