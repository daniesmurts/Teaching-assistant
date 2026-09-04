import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { joinSession, getJoinState, submitAnswer, advanceSelf } from '../api/liveJoin'
import type { LiveJoinState } from '../types'

// Public student join/answer surface for a live quiz (TODO.md Feature Y).
// No account — the server-issued participant_token is the credential.
// Eagerly imported in App.tsx (like StudentWrite) — a student on flaky venue
// wifi shouldn't wait on a lazy chunk.

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 2700   // ~90 minutes at 2s

// A dropped packet, a timeout, or a transient 5xx/429 on venue/mobile wifi is
// common, not exceptional (this is what a live classroom's connectivity
// actually looks like) — one such blip must not permanently kill the poll
// loop. Only a 404 (session or participant genuinely gone) is treated as
// terminal; everything else retries with backoff, capped so a truly dead
// backend still surfaces an error instead of polling silently forever.
const MAX_CONSECUTIVE_FAILURES = 6
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000, 8000, 8000]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isNotFound(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 404
}

const OPTION_LABELS = ['А', 'Б', 'В', 'Г']

function tokenStorageKey(code: string): string {
  return `live-join-token-${code}`
}

export default function LiveJoin() {
  const { code } = useParams<{ code: string }>()
  const [nickname, setNickname] = useState('')
  const [token, setToken] = useState<string | null>(() => {
    // Resume rather than rejoin-as-a-new-participant after an accidental
    // reload (flaky wifi dropping the page, not just individual requests) —
    // losing a student's in-progress score to a reload was its own source
    // of "it broke" reports, independent of the polling fix below.
    if (!code) return null
    try { return sessionStorage.getItem(tokenStorageKey(code)) } catch { return null }
  })
  const [state, setState] = useState<LiveJoinState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  async function join() {
    if (!code || !nickname.trim()) return
    setError(null)
    // A 429/5xx/timeout on the very first request is exactly as likely as on
    // any later one (same flaky venue wifi) — a couple of quick retries
    // before showing "check the code" avoids blaming the code for a blip.
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const result = await joinSession(code, nickname.trim())
        try { sessionStorage.setItem(tokenStorageKey(code), result.participant_token) } catch { /* private mode etc — fine, just no resume-after-reload */ }
        setToken(result.participant_token)
        return
      } catch (err) {
        if (isNotFound(err)) { setError('Сессия не найдена — проверьте код'); return }
        if (attempt < 2) { await delay(1000 * (attempt + 1)); continue }
        setError('Не удалось присоединиться — проверьте подключение к интернету и попробуйте ещё раз')
      }
    }
  }

  useEffect(() => {
    if (!token || !code) return
    cancelled.current = false
    let attempt = 0
    let consecutiveFailures = 0
    async function poll() {
      if (cancelled.current || attempt >= MAX_POLLS) return
      attempt += 1
      try {
        const latest = await getJoinState(code!, token!)
        if (cancelled.current) return
        consecutiveFailures = 0
        setError(null)
        setState(latest)
      } catch (err) {
        if (cancelled.current) return
        if (isNotFound(err)) {
          // Genuinely gone (not a blip) — clear the stored token so a later
          // revisit of this URL prompts a fresh join instead of resuming a
          // dead one forever.
          try { sessionStorage.removeItem(tokenStorageKey(code!)) } catch { /* ignore */ }
          setError('Сессия недоступна')
          return
        }
        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setError('Проблема с подключением — попробуйте обновить страницу')
          return
        }
        await delay(RETRY_BACKOFF_MS[Math.min(consecutiveFailures - 1, RETRY_BACKOFF_MS.length - 1)])
        poll()
        return
      }
      await delay(POLL_INTERVAL_MS)
      poll()
    }
    poll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, code])

  async function answer(choiceIndex: number) {
    if (!code || !token || answering) return
    setAnswering(true)
    try {
      await submitAnswer(code, token, choiceIndex)
      // Self-paced reveals immediately on the next poll (server derives
      // 'reveal' from the answer just recorded) — fetch right away instead
      // of waiting up to 2s for the loop's own tick.
      const latest = await getJoinState(code, token)
      setState(latest)
    } catch { /* 409 (already answered / not accepting) — next poll reconciles state */ }
    setAnswering(false)
  }

  // Self-paced only — move on to the next question after seeing the reveal.
  async function next() {
    if (!code || !token || answering) return
    setAnswering(true)
    try {
      await advanceSelf(code, token)
      const latest = await getJoinState(code, token)
      setState(latest)
    } catch { /* next poll reconciles state */ }
    setAnswering(false)
  }

  if (error) {
    return <Centered><p className="text-danger">{error}</p></Centered>
  }

  if (!token) {
    const canJoin = nickname.trim().length > 0
    return (
      <Centered>
        <div className="text-2xl font-serif font-bold mb-1">Код: {code}</div>
        <p className="text-ink-secondary mb-4">Введите имя, чтобы преподаватель видел, чей это результат</p>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canJoin) join() }}
          placeholder="Ваше имя"
          className="w-full max-w-xs px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink mb-3 focus:outline-none focus:border-border-strong"
        />
        <button
          onClick={join}
          disabled={!canJoin}
          className="w-full max-w-xs px-4 py-3 rounded-md bg-amber text-white font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Присоединиться
        </button>
      </Centered>
    )
  }

  if (!state) {
    return <Centered><p className="text-ink-secondary">Загрузка…</p></Centered>
  }

  if (state.status === 'lobby') {
    return <Centered><p className="text-xl">Ждите начала теста…</p></Centered>
  }

  if (state.status === 'finished') {
    const score = state.participant_score
    return (
      <Centered>
        <p className="text-xl mb-2">Спасибо за участие!</p>
        {score && (
          <p className="text-4xl font-serif font-bold text-amber">
            {score.correct} / {score.total}
          </p>
        )}
      </Centered>
    )
  }

  if (state.question) {
    if (state.status === 'reveal') {
      return (
        <Centered>
          <p className="text-lg mb-4">{state.question.question}</p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {state.question.options.map((opt, i) => {
              const isCorrect = i === state.correct_index
              const isMyWrongPick = i === state.my_choice && !isCorrect
              return (
                <div
                  key={i}
                  className={`px-4 py-3 rounded-md text-left font-sans text-sm border ${
                    isCorrect
                      ? 'bg-success/15 text-success border-success/30'
                      : isMyWrongPick
                        ? 'bg-danger/10 text-danger border-danger/30'
                        : 'bg-surface-warm text-ink-secondary border-transparent'
                  }`}
                >
                  {OPTION_LABELS[i]}. {opt}
                  {isMyWrongPick && <span className="ml-2 text-xs">← ваш ответ</span>}
                </div>
              )
            })}
          </div>
          {state.question.explanation && (
            <p className="text-sm text-ink-secondary mt-4 max-w-xs leading-relaxed">{state.question.explanation}</p>
          )}
          {state.mode === 'self_paced' && (
            <button
              onClick={next}
              disabled={answering}
              className="mt-6 w-full max-w-xs px-4 py-3 rounded-md bg-amber text-white font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Далее
            </button>
          )}
        </Centered>
      )
    }

    if (state.has_answered) {
      return <Centered><p className="text-xl">Ответ принят — ждите остальных</p></Centered>
    }

    return (
      <Centered>
        <p className="text-lg mb-4">{state.question.question}</p>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          {state.question.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => answer(i)}
              disabled={answering}
              className="px-4 py-3 rounded-md bg-surface-warm text-ink font-sans text-sm text-left hover:bg-amber-light transition-colors disabled:opacity-50"
            >
              {OPTION_LABELS[i]}. {opt}
            </button>
          ))}
        </div>
      </Centered>
    )
  }

  return <Centered><p className="text-ink-secondary">Ждите…</p></Centered>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-surface font-sans">
      {children}
    </div>
  )
}
