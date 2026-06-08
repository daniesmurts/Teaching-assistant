import { useState, FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import Button from '../components/ui/Button'
import { submitFeedback, type FeedbackCategory } from '../api/feedback'

const CATEGORIES: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: 'idea',     label: 'Идея',     hint: 'Предложение или пожелание' },
  { value: 'bug',      label: 'Проблема', hint: 'Что-то работает не так' },
  { value: 'question', label: 'Вопрос',   hint: 'Нужна помощь' },
  { value: 'other',    label: 'Другое',   hint: '' },
]

export default function Feedback() {
  const [category, setCategory] = useState<FeedbackCategory>('idea')
  const [message, setMessage]   = useState('')
  const [sent, setSent]         = useState(false)

  const mut = useMutation({
    mutationFn: () => submitFeedback({ category, message: message.trim(), page: window.location.pathname }),
    onSuccess: () => { setSent(true); setMessage('') },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (message.trim().length < 3) return
    mut.mutate()
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Обратная связь" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 md:px-6 py-6">
          {sent ? (
            <div className="bg-surface border border-border rounded-lg p-8 text-center">
              <div className="text-4xl mb-3">🙏</div>
              <h2 className="font-display text-xl font-bold text-ink mb-2">Спасибо за отзыв!</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Мы читаем каждое сообщение. На этапе раннего развития ваш голос напрямую влияет на продукт.
              </p>
              <Button variant="secondary" onClick={() => setSent(false)}>Отправить ещё</Button>
            </div>
          ) : (
            <>
              <p className="font-sans text-sm text-ink-secondary leading-relaxed mb-5">
                ИСПУМ ещё развивается, и ваше мнение особенно ценно. Расскажите, что нравится, что мешает
                или чего не хватает — это попадёт напрямую к команде.
              </p>

              <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
                <div>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Тип обращения
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setCategory(c.value)}
                        className={`text-left px-3 py-2 rounded-md border transition-colors ${
                          category === c.value
                            ? 'border-amber bg-amber-light/50'
                            : 'border-border hover:bg-surface-warm'
                        }`}
                      >
                        <div className="text-sm font-sans font-medium text-ink">{c.label}</div>
                        {c.hint && <div className="text-[11px] font-sans text-ink-tertiary">{c.hint}</div>}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Сообщение
                  </div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    placeholder="Опишите как можно подробнее…"
                    className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed resize-none focus:outline-none focus:border-border-strong"
                    required
                  />
                  <div className="text-[11px] font-sans text-ink-tertiary mt-1 text-right">{message.length}/5000</div>
                </div>

                <Button type="submit" className="w-full" loading={mut.isPending} disabled={message.trim().length < 3}>
                  Отправить отзыв
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
