import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { submitFeedback } from '../../api/feedback'

const VOTES_KEY = 'ga_help_votes'

type Vote = 'up' | 'down'

function readVotes(): Record<string, Vote> {
  try { return JSON.parse(localStorage.getItem(VOTES_KEY) ?? '{}') } catch { return {} }
}

function writeVote(slug: string, vote: Vote) {
  try {
    const votes = readVotes()
    votes[slug] = vote
    localStorage.setItem(VOTES_KEY, JSON.stringify(votes))
  } catch { /* ignore */ }
}

// Article helpfulness rating (§ help feedback). A bare thumbs-down is noise
// at our traffic — this always asks what was missing, which is what makes
// a single vote actionable instead of just a number nobody can act on.
export default function ArticleFeedback({ slug, title }: { slug: string; title: string }) {
  const [vote, setVote] = useState<Vote | null>(() => readVotes()[slug] ?? null)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')

  const mut = useMutation({
    mutationFn: (data: { category: 'help_up' | 'help_down'; message: string }) =>
      submitFeedback({ ...data, page: slug }),
  })

  function up() {
    setVote('up')
    writeVote(slug, 'up')
    mut.mutate({ category: 'help_up', message: `👍 Полезно: ${title}` })
  }

  function down() {
    setVote('down')
    writeVote(slug, 'down')
    setShowComment(true)
  }

  function sendComment(text: string) {
    setShowComment(false)
    mut.mutate({ category: 'help_down', message: text || `👎 Не помогло: ${title}` })
  }

  if (vote && !showComment) {
    return (
      <div className="mt-8 pt-5 border-t border-border">
        <p className="text-xs font-sans text-ink-tertiary">
          {vote === 'up' ? 'Спасибо за оценку! Рады, что статья помогла.' : 'Спасибо, мы учтём это при доработке статьи.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-8 pt-5 border-t border-border">
      {!showComment ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-sans text-ink-secondary">Эта статья была полезна?</span>
          <button
            onClick={up}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:bg-surface-warm transition-colors text-sm"
            aria-label="Полезно"
          >
            👍
          </button>
          <button
            onClick={down}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:bg-surface-warm transition-colors text-sm"
            aria-label="Не полезно"
          >
            👎
          </button>
        </div>
      ) : (
        <div className="max-w-sm">
          <p className="text-sm font-sans text-ink-secondary mb-2">Чего не хватило в статье? (необязательно)</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Например: не описан такой-то случай…"
            className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed resize-none focus:outline-none focus:border-border-strong"
            autoFocus
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => sendComment(comment.trim())}
              className="px-3 py-1.5 rounded-md bg-amber text-white text-xs font-sans font-medium hover:opacity-90 transition-opacity"
            >
              Отправить
            </button>
            <button
              onClick={() => sendComment('')}
              className="px-3 py-1.5 rounded-md text-xs font-sans text-ink-tertiary hover:text-ink transition-colors"
            >
              Пропустить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
