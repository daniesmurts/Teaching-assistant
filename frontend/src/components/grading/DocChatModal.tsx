import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { askDocument, type ChatTurn, type DocChatSource } from '../../api/documents'

interface Props {
  courseId: string
  onClose:  () => void
}

interface DisplayTurn extends ChatTurn {
  sources?: DocChatSource[]
}

/**
 * "Спроси документ" (TODO Feature I) — grounded Q&A over a course's uploaded
 * reference materials. Multi-turn: the full local history is resent each
 * request for continuity, but retrieval re-runs fresh on every question
 * (server-side), so the model always grounds on what's actually relevant to
 * the *current* question rather than drifting on stale context.
 */
export default function DocChatModal({ courseId, onClose }: Props) {
  const [turns, setTurns]     = useState<DisplayTurn[]>([])
  const [question, setQuestion] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const askMut = useMutation({
    mutationFn: (q: string) => askDocument({
      course_id: courseId,
      question:  q,
      history:   turns.map((t) => ({ role: t.role, content: t.content })),
    }),
  })

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, askMut.isPending])

  function submit() {
    const q = question.trim()
    if (!q || askMut.isPending) return
    setTurns((prev) => [...prev, { role: 'user', content: q }])
    setQuestion('')
    askMut.mutate(q, {
      onSuccess: (result) => {
        setTurns((prev) => [...prev, { role: 'assistant', content: result.answer, sources: result.sources }])
      },
      onError: () => {
        setTurns((prev) => [...prev, { role: 'assistant', content: 'Не удалось получить ответ. Попробуйте ещё раз.' }])
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-surface rounded-xl w-full max-w-xl my-8 shadow-sm border border-border flex flex-col"
        style={{ height: 'min(640px, 85vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Спросить документ</h2>
            <p className="text-[11px] font-sans text-ink-tertiary mt-0.5">Ответ строится только на загруженных материалах предмета</p>
          </div>
          <button onClick={onClose} className="text-ink-tertiary hover:text-ink text-lg leading-none" aria-label="Закрыть">×</button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {turns.length === 0 && (
            <p className="text-sm font-sans text-ink-secondary">
              Задайте вопрос по загруженным материалам предмета — например, «что говорит ГОСТ о...» или «какие требования к оформлению...».
              Ответ будет опираться только на эти материалы, со ссылками на источник.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans leading-relaxed ${
                t.role === 'user' ? 'bg-amber text-white' : 'bg-surface-warm text-ink border border-border'
              }`}>
                <div className="whitespace-pre-wrap">{t.content}</div>
                {t.sources && t.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
                    {t.sources.map((s) => (
                      <div key={s.idx} className="text-[11px] font-sans text-ink-tertiary">
                        [{s.idx}] {s.file_name}
                        {s.page_start && (s.page_end && s.page_end !== s.page_start ? ` · стр. ${s.page_start}–${s.page_end}` : ` · стр. ${s.page_start}`)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {askMut.isPending && (
            <div className="flex justify-start">
              <div className="bg-surface-warm border border-border rounded-lg px-3 py-2 text-sm font-sans text-ink-tertiary">Ищу в материалах…</div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex-shrink-0 flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="Ваш вопрос…"
            disabled={askMut.isPending}
            className="flex-1 px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong disabled:opacity-60"
          />
          <button
            onClick={submit}
            disabled={askMut.isPending || !question.trim()}
            className="px-4 py-2 text-sm font-sans font-medium text-white bg-amber rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Спросить
          </button>
        </div>
      </div>
    </div>
  )
}
