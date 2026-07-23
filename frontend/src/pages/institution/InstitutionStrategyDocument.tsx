import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getStrategyDocument, uploadStrategyDocument, deleteStrategyDocument,
  type StrategyDocumentStatus,
} from '../../api/institution'

// Feature Z Plane-2 pilot — one grounded document (the university's own
// «стратегия развития») that РОП Студия's market-evidence generator can
// cite alongside its Plane-1 vacancy data. Exactly one document per
// institution — uploading again replaces it server-side, so this page is
// deliberately just status + upload + delete, no version history.

const STATUS_LABEL: Record<StrategyDocumentStatus['processing_status'], string> = {
  pending:    'В очереди…',
  extracting: 'Извлекаем текст…',
  chunking:   'Готовим для поиска…',
  ready:      'Готово',
  failed:     'Не удалось обработать',
}

export default function InstitutionStrategyDocument() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['institution-strategy-document'],
    queryFn:  getStrategyDocument,
  })

  const uploadMut = useMutation({
    mutationFn: uploadStrategyDocument,
    onSuccess: (fresh) => {
      qc.setQueryData(['institution-strategy-document'], fresh)
      addToast('Документ загружен, обрабатывается', 'success')
    },
    onError: () => addToast('Не удалось загрузить документ', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteStrategyDocument,
    onSuccess: () => {
      qc.setQueryData(['institution-strategy-document'], null)
      setConfirmingDelete(false)
      addToast('Документ удалён', 'success')
    },
    onError: () => addToast('Не удалось удалить документ', 'error'),
  })

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) uploadMut.mutate(file)
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">Стратегия развития университета</h1>
        <p className="text-xs font-sans text-ink-tertiary mb-6 max-w-prose leading-relaxed">
          Загрузите документ стратегии развития университета — «РОП Студия» сможет дословно
          ссылаться на него в «Обосновании актуальности», связывая программу со стратегическими
          приоритетами вуза. Один документ на организацию: повторная загрузка заменяет предыдущий.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={onFileChosen}
        />

        {data ? (
          <div className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-sans font-semibold text-ink truncate mb-1">{data.file_name}</div>
                <div className="text-xs font-sans text-ink-tertiary">
                  Загружен {new Date(data.uploaded_at).toLocaleDateString('ru-RU')} ·{' '}
                  <span className={data.processing_status === 'failed' ? 'text-danger' : data.processing_status === 'ready' ? 'text-success' : ''}>
                    {STATUS_LABEL[data.processing_status]}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="secondary" size="sm" loading={uploadMut.isPending} onClick={() => fileInputRef.current?.click()}>
                  Заменить
                </Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Удалить
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-surface border border-dashed border-border-mid rounded-lg p-8 text-center">
            <p className="font-sans text-sm text-ink-secondary mb-4">Документ ещё не загружен.</p>
            <Button loading={uploadMut.isPending} onClick={() => fileInputRef.current?.click()}>
              Загрузить документ
            </Button>
          </div>
        )}

        {confirmingDelete && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setConfirmingDelete(false)}>
            <div className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-5">
                <h2 className="font-display text-xl font-bold text-ink tracking-tight mb-2">Удалить документ?</h2>
                <p className="font-sans text-sm text-ink-secondary leading-relaxed">
                  «РОП Студия» перестанет ссылаться на стратегию развития в новых обоснованиях. Уже
                  сгенерированные тексты не изменятся.
                </p>
              </div>
              <div className="flex gap-2 px-6 py-4 border-t border-border">
                <Button variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} className="flex-1">
                  Удалить
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>Отмена</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
