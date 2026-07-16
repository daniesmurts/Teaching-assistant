import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { getLiveSession, advanceLiveSession, finishLiveSession } from '../api/liveSessions'
import Button from '../components/ui/Button'
import type { LiveSession } from '../types'

// Projector view for a live quiz session (TODO.md Feature Y). Chrome-free —
// mounted via <ProtectedRoute> directly (no AppShell), a sibling of
// /write/:token in App.tsx, so it fills the whole screen for projecting.

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 2700   // ~90 minutes at 2s — covers a full lecture

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const OPTION_LABELS = ['А', 'Б', 'В', 'Г']

export default function LiveSessionHost() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<LiveSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  useEffect(() => {
    if (!sessionId) return
    cancelled.current = false
    let attempt = 0
    async function poll() {
      if (cancelled.current || attempt >= MAX_POLLS) return
      attempt += 1
      try {
        const latest = await getLiveSession(sessionId!)
        if (cancelled.current) return
        setSession(latest)
      } catch {
        if (!cancelled.current) setError('Не удалось загрузить сессию')
        return
      }
      await delay(POLL_INTERVAL_MS)
      poll()
    }
    poll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function next() {
    if (!sessionId) return
    setSession(await advanceLiveSession(sessionId))
  }

  async function finish() {
    if (!sessionId) return
    setSession(await finishLiveSession(sessionId))
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-white font-sans">
        {error}
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-white font-sans">
        Загрузка сессии…
      </div>
    )
  }

  const joinUrl = `${window.location.origin}/live/${session.join_code}`

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col items-center justify-center p-8 font-sans">
      {session.status === 'lobby' && (
        <LobbyView session={session} joinUrl={joinUrl} onStart={next} />
      )}
      {(session.status === 'question' || session.status === 'reveal') && (
        <QuestionView session={session} onNext={next} onFinish={finish} />
      )}
      {session.status === 'finished' && (
        <FinishedView session={session} onExit={() => navigate('/quizzes')} />
      )}
    </div>
  )
}

function LobbyView({ session, joinUrl, onStart }: { session: LiveSession; joinUrl: string; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center max-w-2xl">
      <div>
        <div className="text-sm uppercase tracking-wider text-white/50 mb-2">Присоединяйтесь</div>
        <div className="text-7xl font-serif font-bold tracking-widest">{session.join_code}</div>
        <div className="text-white/60 mt-2">{joinUrl}</div>
      </div>

      <div className="w-64 h-64 bg-white rounded-lg flex items-center justify-center p-4">
        <QRCodeSVG value={joinUrl} size={224} />
      </div>

      <div className="text-2xl">
        {session.participant_count} {participantWord(session.participant_count)} подключились
      </div>

      <Button onClick={onStart} size="md" className="text-lg px-8 py-3">
        Начать
      </Button>
    </div>
  )
}

function QuestionView({ session, onNext, onFinish }: { session: LiveSession; onNext: () => void; onFinish: () => void }) {
  const counts = session.answer_counts ?? [0, 0, 0, 0]
  const total = counts.reduce((a, b) => a + b, 0)
  const isReveal = session.status === 'reveal'

  return (
    <div className="w-full max-w-3xl flex flex-col gap-8">
      <div className="text-center text-sm uppercase tracking-wider text-white/50">
        Вопрос {session.current_question_index + 1}
      </div>

      <div className="flex flex-col gap-4">
        {counts.map((count, i) => {
          const pct = total > 0 ? (count / total) * 100 : 0
          const isCorrect = isReveal && session.results?.[session.current_question_index]?.correct_index === i
          return (
            <div key={i} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold shrink-0">
                {OPTION_LABELS[i]}
              </div>
              <div className="flex-1 h-10 bg-white/10 rounded-md overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-500 ${isCorrect ? 'bg-success' : 'bg-amber'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-12 text-right font-bold">{count}</div>
            </div>
          )
        })}
      </div>

      <div className="text-center text-white/60">{total} {answerWord(total)}</div>

      <div className="flex justify-center gap-3">
        {!isReveal && (
          <Button onClick={onNext} size="md" className="text-lg px-8 py-3">
            Показать ответ
          </Button>
        )}
        {isReveal && (
          <>
            <Button onClick={onNext} size="md" className="text-lg px-8 py-3">
              Следующий вопрос
            </Button>
            <Button variant="secondary" onClick={onFinish} size="md" className="text-lg px-8 py-3">
              Завершить
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function FinishedView({ session, onExit }: { session: LiveSession; onExit: () => void }) {
  const results = session.results ?? []
  return (
    <div className="w-full max-w-2xl flex flex-col gap-6 text-center">
      <div className="text-3xl font-serif font-bold">Сессия завершена</div>
      <div className="flex flex-col gap-3">
        {results.map((r) => {
          const total = r.answer_counts.reduce((a, b) => a + b, 0)
          const correctPct = total > 0 ? Math.round((r.answer_counts[r.correct_index] / total) * 100) : 0
          return (
            <div key={r.question_index} className="flex items-center justify-between bg-white/10 rounded-md px-4 py-3">
              <span>Вопрос {r.question_index + 1}</span>
              <span className={correctPct >= 50 ? 'text-success' : 'text-warning'}>{correctPct}% верно</span>
            </div>
          )
        })}
      </div>
      <Button onClick={onExit} size="md" className="mx-auto text-lg px-8 py-3">
        К тестам
      </Button>
    </div>
  )
}

function participantWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'участник'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'участника'
  return 'участников'
}

function answerWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ответ'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'ответа'
  return 'ответов'
}
