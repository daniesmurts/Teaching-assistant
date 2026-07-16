import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { joinSession, getJoinState, submitAnswer } from '../api/liveJoin'
import type { LiveJoinState } from '../types'

// Public student join/answer surface for a live quiz (TODO.md Feature Y).
// No account — the server-issued participant_token is the credential.
// Eagerly imported in App.tsx (like StudentWrite) — a student on flaky venue
// wifi shouldn't wait on a lazy chunk.

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 2700   // ~90 minutes at 2s

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const OPTION_LABELS = ['А', 'Б', 'В', 'Г']

export default function LiveJoin() {
  const { code } = useParams<{ code: string }>()
  const [nickname, setNickname] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [state, setState] = useState<LiveJoinState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  async function join() {
    if (!code) return
    setError(null)
    try {
      const result = await joinSession(code, nickname.trim() || undefined)
      setToken(result.participant_token)
    } catch {
      setError('Не удалось присоединиться — проверьте код')
    }
  }

  useEffect(() => {
    if (!token || !code) return
    cancelled.current = false
    let attempt = 0
    async function poll() {
      if (cancelled.current || attempt >= MAX_POLLS) return
      attempt += 1
      try {
        const latest = await getJoinState(code!, token!)
        if (cancelled.current) return
        setState(latest)
      } catch {
        if (!cancelled.current) setError('Сессия недоступна')
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
      setState((prev) => prev ? { ...prev, has_answered: true } : prev)
    } catch { /* 409 (already answered / not accepting) — next poll reconciles state */ }
    setAnswering(false)
  }

  if (error) {
    return <Centered><p className="text-danger">{error}</p></Centered>
  }

  if (!token) {
    return (
      <Centered>
        <div className="text-2xl font-serif font-bold mb-1">Код: {code}</div>
        <p className="text-ink-secondary mb-4">Введите имя (необязательно) и присоединитесь</p>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Ваше имя"
          className="w-full max-w-xs px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink mb-3 focus:outline-none focus:border-border-strong"
        />
        <button
          onClick={join}
          className="w-full max-w-xs px-4 py-3 rounded-md bg-amber text-white font-sans font-medium hover:opacity-90 transition-opacity"
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
    return <Centered><p className="text-xl">Спасибо за участие!</p></Centered>
  }

  if (state.question) {
    if (state.status === 'reveal') {
      return (
        <Centered>
          <p className="text-lg mb-4">{state.question.question}</p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {state.question.options.map((opt, i) => (
              <div
                key={i}
                className={`px-4 py-3 rounded-md text-left font-sans text-sm ${
                  i === state.correct_index ? 'bg-success/15 text-success border border-success/30' : 'bg-surface-warm text-ink-secondary'
                }`}
              >
                {OPTION_LABELS[i]}. {opt}
              </div>
            ))}
          </div>
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
