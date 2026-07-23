import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { getLiveSession, advanceLiveSession, finishLiveSession, saveLiveSessionToJournal } from '../api/liveSessions'
import { getQuiz } from '../api/quizzes'
import { getStudents } from '../api/grading'
import { getCourses } from '../api/courses'
import { getBrsSchemeForCourse } from '../api/brs'
import Button from '../components/ui/Button'
import { useUIStore } from '../store/uiStore'
import type { LiveSession, LiveSessionParticipantProgress, Quiz, QuizQuestion } from '../types'

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
  const [quiz, setQuiz] = useState<Quiz | null>(null)
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

  // The session/poll response only carries aggregate counts, not the quiz's
  // own question/option/explanation text — fetch the quiz itself once so the
  // projector can actually display what it's asking, not just letter badges
  // and numbers next to empty bars.
  useEffect(() => {
    if (!session?.quiz_id || quiz) return
    getQuiz(session.quiz_id).then(setQuiz).catch(() => null)
  }, [session?.quiz_id, quiz])

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

  const isSelfPaced = session.mode === 'self_paced'

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col items-center justify-center p-8 font-sans">
      {session.status === 'lobby' && (
        <LobbyView session={session} joinUrl={joinUrl} onStart={next} />
      )}
      {isSelfPaced && session.status !== 'lobby' && (
        <RosterView
          session={session}
          quiz={quiz}
          totalQuestions={quiz?.questions.length ?? 0}
          finished={session.status === 'finished'}
          onFinish={finish}
          onExit={() => navigate('/quizzes')}
        />
      )}
      {!isSelfPaced && (session.status === 'question' || session.status === 'reveal') && (
        <QuestionView session={session} question={quiz?.questions[session.current_question_index] ?? null} onNext={next} onFinish={finish} />
      )}
      {!isSelfPaced && session.status === 'finished' && (
        <FinishedView session={session} quiz={quiz} onExit={() => navigate('/quizzes')} />
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

// Self-paced projector view — there's no single shared question to show, so
// instead of a histogram this is a live roster: who's on which question,
// who's finished. «Завершить» only stops new joins — it deliberately never
// force-ends a student mid-quiz (see routes/liveSessions.ts's closeLiveSession
// comment), so the copy here is explicit about that rather than reading like
// a kill switch.
function RosterView({
  session, quiz, totalQuestions, finished, onFinish, onExit,
}: { session: LiveSession; quiz: Quiz | null; totalQuestions: number; finished: boolean; onFinish: () => void; onExit: () => void }) {
  const participants = session.participants ?? []
  const doneCount = participants.filter((p) => p.finished_at).length

  return (
    <div className="w-full max-w-2xl flex flex-col gap-6">
      <div className="text-center">
        <div className="text-sm uppercase tracking-wider text-white/50 mb-1">
          {finished ? 'Сессия завершена' : 'В своём темпе'}
        </div>
        <div className="text-2xl font-serif">
          {doneCount} из {participants.length} завершили
        </div>
      </div>

      <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
        {participants.length === 0 && (
          <div className="text-center text-white/50 py-8">Пока никто не подключился</div>
        )}
        {participants.map((p, i) => {
          const pct = totalQuestions > 0 ? Math.min(100, (p.current_question_index / totalQuestions) * 100) : 0
          return (
            <div key={i} className="flex items-center gap-4 bg-white/10 rounded-md px-4 py-2.5">
              <div className="w-32 truncate text-sm">{p.nickname ?? 'Без имени'}</div>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${p.finished_at ? 'bg-success' : 'bg-amber'}`}
                  style={{ width: `${p.finished_at ? 100 : pct}%` }}
                />
              </div>
              <div className="w-20 text-right text-sm text-white/60 shrink-0">
                {p.finished_at ? `${p.score.correct} / ${p.score.total}` : `${p.current_question_index} / ${totalQuestions}`}
              </div>
            </div>
          )
        })}
      </div>

      {!finished && (
        <div className="flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={onFinish} size="md" className="text-lg px-8 py-3">
            Завершить приём участников
          </Button>
          <p className="text-xs text-white/40 max-w-sm text-center">
            Не прерывает тех, кто уже проходит тест — только закрывает вход новым участникам.
          </p>
        </div>
      )}
      {finished && (
        <div className="flex flex-col items-center gap-4">
          <SaveToJournalPanel sessionId={session.id} quiz={quiz} participants={participants} />
          <Button onClick={onExit} size="md" className="text-lg px-8 py-3">
            К тестам
          </Button>
        </div>
      )}
    </div>
  )
}

function QuestionView({
  session, question, onNext, onFinish,
}: { session: LiveSession; question: QuizQuestion | null; onNext: () => void; onFinish: () => void }) {
  const counts = session.answer_counts ?? [0, 0, 0, 0]
  const total = counts.reduce((a, b) => a + b, 0)
  const isReveal = session.status === 'reveal'

  return (
    <div className="w-full max-w-3xl flex flex-col gap-8">
      <div>
        <div className="text-center text-sm uppercase tracking-wider text-white/50 mb-3">
          Вопрос {session.current_question_index + 1}
        </div>
        {question && <div className="text-center text-2xl font-serif">{question.question}</div>}
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
                {question && (
                  <div className="absolute inset-0 flex items-center px-3 text-sm font-medium text-white truncate">
                    {question.options[i]}
                  </div>
                )}
              </div>
              <div className="w-12 text-right font-bold">{count}</div>
            </div>
          )
        })}
      </div>

      <div className="text-center text-white/60">{total} {answerWord(total)}</div>

      {isReveal && question?.explanation && (
        <p className="text-center text-white/70 text-sm max-w-2xl mx-auto leading-relaxed">{question.explanation}</p>
      )}

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

function FinishedView({ session, quiz, onExit }: { session: LiveSession; quiz: Quiz | null; onExit: () => void }) {
  const results = session.results ?? []
  // Highest score first — this is the "who got what points" list; per-
  // question aggregate below answers a different question (which question
  // was hard), so both stay, side by side.
  const leaderboard = [...(session.participants ?? [])].sort((a, b) => b.score.correct - a.score.correct)

  return (
    <div className="w-full max-w-3xl flex flex-col gap-8 text-center">
      <div className="text-3xl font-serif font-bold">Сессия завершена</div>

      {leaderboard.length > 0 && (
        <div>
          <div className="text-sm uppercase tracking-wider text-white/50 mb-3">Результаты участников</div>
          <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
            {leaderboard.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-4 bg-white/10 rounded-md px-4 py-2.5">
                <span className="text-left truncate">{p.nickname ?? 'Без имени'}</span>
                <span className="shrink-0 font-bold text-amber">{p.score.correct} / {p.score.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div>
          <div className="text-sm uppercase tracking-wider text-white/50 mb-3">По вопросам</div>
          <div className="flex flex-col gap-2">
            {results.map((r) => {
              const total = r.answer_counts.reduce((a, b) => a + b, 0)
              const correctPct = total > 0 ? Math.round((r.answer_counts[r.correct_index] / total) * 100) : 0
              const questionText = quiz?.questions[r.question_index]?.question
              return (
                <div key={r.question_index} className="flex items-center justify-between gap-4 bg-white/10 rounded-md px-4 py-3">
                  <span className="text-left truncate">{questionText ?? `Вопрос ${r.question_index + 1}`}</span>
                  <span className={`shrink-0 ${correctPct >= 50 ? 'text-success' : 'text-warning'}`}>{correctPct}% верно</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <SaveToJournalPanel sessionId={session.id} quiz={quiz} participants={session.participants ?? []} />

      <Button onClick={onExit} size="md" className="mx-auto text-lg px-8 py-3">
        К тестам
      </Button>
    </div>
  )
}

// Turns live-quiz results into real journal entries (assignments) so they
// can count toward a semester grade — teacher-reviewed, not automatic
// (matches the app's existing "AI/automated output is never final" rule).
// A live-quiz participant has only a free-text nickname, not a real student
// identity, so this is also where that gets resolved: prefilled from the
// nickname, editable, with the same name/group autocomplete GradingForm.tsx
// uses (<input list> + <datalist> fed by getStudents(courseId)).
function SaveToJournalPanel({
  sessionId, quiz, participants,
}: { sessionId: string; quiz: Quiz | null; participants: LiveSessionParticipantProgress[] }) {
  const addToast = useUIStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(() => participants.map((p) => ({
    participant_id: p.id, nickname: p.nickname, score: p.score, already_saved: p.already_saved,
    include: !p.already_saved, student_name: p.nickname ?? '', student_group: '',
  })))
  const [courseId, setCourseId] = useState('')
  const [checkpointId, setCheckpointId] = useState('')
  const [saving, setSaving] = useState(false)

  const effectiveCourseId = quiz?.course_id ?? courseId
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses, enabled: open && !quiz?.course_id })
  const { data: students = [] } = useQuery({
    queryKey: ['students', effectiveCourseId],
    queryFn: () => getStudents(effectiveCourseId || undefined),
    enabled: open,
  })
  // Feature AE — one checkpoint applies to the whole batch save below.
  const { data: brsScheme } = useQuery({
    queryKey: ['brs-scheme', effectiveCourseId],
    queryFn: () => getBrsSchemeForCourse(effectiveCourseId),
    enabled: open && Boolean(effectiveCourseId),
  })
  const brsCheckpoints = brsScheme?.status === 'published' ? brsScheme.checkpoints : []
  const nameSuggestions = Array.from(new Set(students.map((s) => s.student_name).filter(Boolean)))
  const groupSuggestions = Array.from(new Set(students.map((s) => s.student_group).filter((g): g is string => Boolean(g))))

  function updateRow(id: string, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r) => r.participant_id === id ? { ...r, ...patch } : r))
  }

  async function save() {
    const toSave = rows.filter((r) => r.include && !r.already_saved && r.student_name.trim())
    if (toSave.length === 0) return
    if (!effectiveCourseId) { addToast('Выберите предмет', 'error'); return }
    setSaving(true)
    try {
      const result = await saveLiveSessionToJournal(
        sessionId, effectiveCourseId,
        toSave.map((r) => ({ participant_id: r.participant_id, student_name: r.student_name.trim(), student_group: r.student_group.trim() || undefined })),
        checkpointId || undefined,
      )
      addToast(`Сохранено в журнал: ${result.created}${result.skipped ? `, пропущено: ${result.skipped}` : ''}`, 'success')
      const savedIds = new Set(toSave.map((r) => r.participant_id))
      setRows((prev) => prev.map((r) => savedIds.has(r.participant_id) ? { ...r, already_saved: true, include: false } : r))
    } catch {
      addToast('Не удалось сохранить в журнал', 'error')
    }
    setSaving(false)
  }

  if (rows.length === 0) return null

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} size="md" className="text-lg px-8 py-3">
        Сохранить в журнал
      </Button>
    )
  }

  const includedCount = rows.filter((r) => r.include && !r.already_saved).length

  return (
    <div className="w-full bg-white/5 border border-white/10 rounded-lg p-5 text-left">
      <div className="text-sm uppercase tracking-wider text-white/50 mb-3">Сохранить результаты в журнал</div>

      {!quiz?.course_id && (
        <div className="mb-4">
          <label className="block text-xs text-white/60 mb-1">Предмет</label>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white text-sm"
          >
            <option value="">— выберите предмет —</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {brsCheckpoints.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs text-white/60 mb-1">Контрольная точка БРС (опционально)</label>
          <select
            value={checkpointId}
            onChange={(e) => setCheckpointId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white text-sm"
          >
            <option value="">Без контрольной точки</option>
            {brsCheckpoints.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <datalist id="journal-name-suggestions">
        {nameSuggestions.map((n) => <option key={n} value={n} />)}
      </datalist>
      <datalist id="journal-group-suggestions">
        {groupSuggestions.map((g) => <option key={g} value={g} />)}
      </datalist>

      <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto mb-4">
        {rows.map((r) => (
          <div key={r.participant_id} className="flex items-center gap-3 bg-white/5 rounded-md px-3 py-2">
            <input
              type="checkbox"
              checked={r.include}
              disabled={r.already_saved}
              onChange={(e) => updateRow(r.participant_id, { include: e.target.checked })}
              className="shrink-0"
            />
            <div className="w-24 truncate text-xs text-white/50 shrink-0">{r.nickname ?? '—'}</div>
            <input
              value={r.student_name}
              onChange={(e) => updateRow(r.participant_id, { student_name: e.target.value })}
              disabled={r.already_saved}
              list="journal-name-suggestions"
              placeholder="ФИО студента"
              className="flex-1 min-w-0 px-2 py-1.5 rounded bg-white/10 border border-white/20 text-white text-sm placeholder:text-white/30 disabled:opacity-40"
            />
            <input
              value={r.student_group}
              onChange={(e) => updateRow(r.participant_id, { student_group: e.target.value })}
              disabled={r.already_saved}
              list="journal-group-suggestions"
              placeholder="Группа"
              className="w-28 shrink-0 px-2 py-1.5 rounded bg-white/10 border border-white/20 text-white text-sm placeholder:text-white/30 disabled:opacity-40"
            />
            <div className="w-16 text-right text-sm text-white/60 shrink-0">{r.score.correct} / {r.score.total}</div>
            {r.already_saved && <span className="text-xs text-success shrink-0 w-20 text-right">сохранено</span>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving} disabled={includedCount === 0}>
          {includedCount > 0 ? `Сохранить ${includedCount} в журнал` : 'Нечего сохранять'}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Скрыть</Button>
      </div>
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
