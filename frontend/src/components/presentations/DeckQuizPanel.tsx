import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Select from '../ui/Select'
import { createQuizFromPresentation, getPresentationQuizzes } from '../../api/presentations'
import { createLiveSession } from '../../api/liveSessions'
import { useUIStore } from '../../store/uiStore'
import type { Quiz, QuizLevel, LiveSessionMode } from '../../types'

// Лекция → тест → аудитория (TODO.md "### AO" Phase 3).
//
// The deck, the test and the live QR session were three features that never
// touched: a teacher generated a lecture, then re-described the same material
// by hand on the Тесты page to get a test out of it. This panel closes that
// loop in place — the test is built from the deck's own slides and speaker
// notes, and because it is an ordinary quiz row, «Запустить в аудитории»
// (Feature Y) works on it unchanged.

const COUNT_OPTIONS = [
  { value: '5',  label: '5 вопросов' },
  { value: '8',  label: '8 вопросов' },
  { value: '12', label: '12 вопросов' },
  { value: '20', label: '20 вопросов' },
]

const LEVEL_OPTIONS = [
  { value: 'recall',        label: 'Запоминание' },
  { value: 'understanding', label: 'Понимание' },
  { value: 'application',   label: 'Применение' },
]

export default function DeckQuizPanel({ presentationId }: { presentationId: string }) {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)

  const [count, setCount] = useState('8')
  const [level, setLevel] = useState<QuizLevel>('understanding')
  const [mode, setMode]   = useState<LiveSessionMode>('paced')
  const [fresh, setFresh] = useState<Quiz | null>(null)

  // Tests already made from this deck, so a second click offers to run the
  // existing one instead of quietly generating (and billing) a duplicate.
  const { data: existing = [], refetch } = useQuery({
    queryKey: ['presentation-quizzes', presentationId],
    queryFn: () => getPresentationQuizzes(presentationId),
    enabled: Boolean(presentationId),
  })

  const quiz = fresh ?? existing[0] ?? null

  const generateMut = useMutation({
    mutationFn: () => createQuizFromPresentation(presentationId, Number(count), level),
    onSuccess: (q) => { setFresh(q); void refetch() },
    onError: (err: unknown) => {
      const res = (err as { response?: { status?: number; data?: { error?: string } } }).response
      addToast(
        res?.status === 403
          ? (res.data?.error ?? 'Достигнут месячный лимит генерации тестов')
          : (res?.data?.error ?? 'Не удалось создать тест'),
        'error',
      )
    },
  })

  const launchMut = useMutation({
    mutationFn: () => createLiveSession(quiz!.id, mode),
    onSuccess: (session) => navigate(`/live/host/${session.id}`),
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status
      addToast(
        status === 403
          ? 'Достигнут лимит живых сессий на бесплатном тарифе в этом месяце.'
          : 'Не удалось запустить сессию',
        'error',
      )
    },
  })

  return (
    <div className="bg-surface border border-border rounded-lg p-4 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-sans text-sm font-medium text-ink">Проверить усвоение</div>
          <p className="font-sans text-xs text-ink-secondary mt-0.5 max-w-[60ch]">
            {quiz
              ? `Тест по этой лекции готов — ${quiz.question_count} вопросов. Запустите его в аудитории: студенты отвечают со своих телефонов, результаты можно сохранить в журнал.`
              : 'Тест составляется по слайдам и заметкам этой лекции — только по тому, что вы действительно рассказали.'}
          </p>
        </div>

        {!quiz ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Select size="sm" value={count} onChange={setCount} options={COUNT_OPTIONS} ariaLabel="Количество вопросов" />
            <Select size="sm" value={level} onChange={(v) => setLevel(v as QuizLevel)} options={LEVEL_OPTIONS} ariaLabel="Уровень вопросов" />
            <Button size="sm" onClick={() => generateMut.mutate()} loading={generateMut.isPending}>
              Составить тест
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Pacing is chosen at launch, as on the Тесты page — it changes
                the whole interaction model rather than something togglable
                mid-session. */}
            <div className="inline-flex rounded-md border border-border-mid overflow-hidden" role="group" aria-label="Темп прохождения">
              <button
                onClick={() => setMode('paced')}
                className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap transition-colors ${
                  mode === 'paced' ? 'bg-amber text-white' : 'bg-surface text-ink-secondary hover:bg-surface-warm'
                }`}
              >
                В темпе группы
              </button>
              <button
                onClick={() => setMode('self_paced')}
                className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap border-l border-border-mid transition-colors ${
                  mode === 'self_paced' ? 'bg-amber text-white' : 'bg-surface text-ink-secondary hover:bg-surface-warm'
                }`}
              >
                В своём темпе
              </button>
            </div>
            <Button size="sm" onClick={() => launchMut.mutate()} loading={launchMut.isPending}>
              <Icon name="play-circle" size={14} />
              Запустить в аудитории
            </Button>
            <button
              onClick={() => navigate('/materials/quizzes')}
              className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
            >
              Открыть в «Тестах»
            </button>
          </div>
        )}
      </div>

      {existing.length > 1 && (
        <div className="mt-2 font-sans text-[11px] text-ink-tertiary">
          По этой лекции уже создано тестов: {existing.length}. Запускается самый свежий.
        </div>
      )}
    </div>
  )
}
