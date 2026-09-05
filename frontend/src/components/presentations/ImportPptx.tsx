import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Icon from '../ui/Icon'
import { importPresentationPptx } from '../../api/presentations'
import { useUIStore } from '../../store/uiStore'
import type { Presentation } from '../../types'

// «Загрузить свою презентацию» (TODO.md "### AO" Phase 4).
//
// Sits beside the generator on purpose: for a teacher meeting ИСПУМ for the
// first time, "upload the lecture you gave last week" is a far lower bar than
// "describe a lecture from scratch", and it lands them in the same place —
// an editable deck that can be rewritten slide by slide, turned into a test,
// a раздатка or a письменная работа, and marked «Готово».

export default function ImportPptx({ onImported }: { onImported: (p: Presentation) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const addToast = useUIStore((s) => s.addToast)
  const qc = useQueryClient()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-picking the same file after an error
    if (!file) return

    setBusy(true)
    try {
      const { presentation, source_slide_count } = await importPresentationPptx(file)
      qc.invalidateQueries({ queryKey: ['presentations'] })
      addToast(`Загружено слайдов: ${source_slide_count}`, 'success')
      onImported(presentation)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(message ?? 'Не удалось загрузить презентацию', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="font-sans text-sm font-medium text-ink">Уже есть своя презентация?</div>
        <p className="font-sans text-xs text-ink-secondary mt-0.5 max-w-[62ch]">
          Загрузите .pptx — ИСПУМ разберёт её по слайдам вместе с заметками докладчика.
          Дальше с ней можно всё то же самое: переписать отдельный слайд, составить тест,
          сделать раздатку или письменную работу.
        </p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-2 rounded-md bg-surface border border-border-mid shadow-sm text-xs font-sans font-medium text-ink-secondary hover:bg-surface-warm hover:text-amber transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber whitespace-nowrap"
      >
        <Icon name="import" size={14} />
        {busy ? 'Разбираем…' : 'Загрузить .pptx'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
