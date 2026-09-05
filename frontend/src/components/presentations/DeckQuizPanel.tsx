import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import LoadingSpinner from '../ui/LoadingSpinner'
import Select from '../ui/Select'
import {
  createQuizFromPresentation, getPresentationQuizzes,
  downloadPresentationHandout, createAssignmentFromPresentation,
  startNotesJob, getPresentationJob,
} from '../../api/presentations'
import { createLiveSession } from '../../api/liveSessions'
import { useUIStore } from '../../store/uiStore'
import type { Quiz, QuizLevel, LiveSessionMode, Slide } from '../../types'

// What a teacher does with a finished lecture (TODO.md "### AO" Phase 3).
//
// Лекция → тест → аудитория, лекция → раздатка, лекция → письменная работа.
//
// The deck, the test and the live QR session were three features that never
// touched: a teacher generated a lecture, then re-described the same material
// by hand on the Тесты page to get a test out of it. This panel closes that
// loop in place — the test is built from the deck's own slides and speaker
// notes, and because it is an ordinary quiz row, «Запустить в аудитории»
// (Feature Y) works on it unchanged.

// Secondary actions look like buttons, not sentences. The first cut of this row
// was three bare text links in a line — «Раздатка для студентов (PDF)  …без
// конспекта  Письменная работа по вопросам лекции» — which teachers read as a
// caption and never clicked. Three separate defects, all fixed below:
//
//   1. No affordance. Same size, weight and colour as body copy, no border, no
//      icon: nothing said "clickable" until the cursor was already on it.
//   2. «…без конспекта» is not a third action — it is a *variant* of the first
//      one, and sitting as a peer it read as a sentence fragment. It is now
//      visibly welded to Раздатка as a split button.
//   3. ~17px tall hit areas, well under the 44px touch guideline. Now 40px:
//      short of 44 to stay in the app's density, but more than double before.
//
// The border/surface/shadow treatment is deliberately the one already used by
// «Показать все ответы» (Quizzes.tsx) and FosStudio — a new button style here
// would fix affordance by breaking consistency.
const ACTION =
  'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-sans font-medium ' +
  'text-ink-secondary bg-surface transition-colors ' +
  'hover:bg-surface-warm hover:text-amber ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ' +
  'disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-ink-secondary'

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

export default function DeckQuizPanel({ presentationId, slides, onSlidesChange }: {
  presentationId: string
  slides?: Slide[] | null
  onSlidesChange?: (slides: Slide[]) => void
}) {
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

  // Discussion slides are already a question bank written for this lecture, so
  // this is a rendering, not a generation — no model call, no wait. The draft
  // lands in the existing published-assignment flow, which is where deadlines
  // and the student roster live.
  // Slides an imported deck arrived without notes for. The whole promise of
  // «Загрузить свою презентацию» is that ИСПУМ writes them, and until this
  // existed the only way was «Переписать», one slide at a time.
  const missingNotes = (slides ?? []).filter((s) => s.type !== 'title' && !s.notes?.trim()).length

  const notesMut = useMutation({
    mutationFn: async () => {
      const job = await startNotesJob(presentationId)
      // Same poll loop the generator uses; a long deck takes a few minutes.
      for (let i = 0; i < 160; i++) {
        await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 3000))
        const status = await getPresentationJob(job.id)
        if (status.status === 'ready' && status.result) return status.result
        if (status.status === 'failed') throw new Error(status.error_message || 'Не удалось написать заметки')
      }
      throw new Error('Слишком долго — попробуйте позже')
    },
    onSuccess: (result) => {
      if (result.slides) onSlidesChange?.(result.slides)
      addToast('Заметки докладчика готовы', 'success')
    },
    onError: (err: unknown) => {
      const res = (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
      addToast(res ?? (err as Error).message ?? 'Не удалось написать заметки', 'error')
    },
  })

  const assignmentMut = useMutation({
    mutationFn: () => createAssignmentFromPresentation(presentationId),
    onSuccess: (a) => navigate(`/published/${a.id}`),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { error?: string } } }).response?.data
      addToast(data?.error ?? 'Не удалось создать задание', 'error')
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
            <div className="inline-flex rounded-md border border-border-mid overflow-hidden" role="radiogroup" aria-label="Темп прохождения">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'paced'}
                onClick={() => setMode('paced')}
                className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap transition-colors ${
                  mode === 'paced'
                    ? 'bg-surface-warm text-ink font-semibold shadow-inner'
                    : 'bg-surface text-ink-secondary hover:bg-surface-warm'
                }`}
              >
                В темпе группы
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'self_paced'}
                onClick={() => setMode('self_paced')}
                className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap border-l border-border-mid transition-colors ${
                  mode === 'self_paced'
                    ? 'bg-surface-warm text-ink font-semibold shadow-inner'
                    : 'bg-surface text-ink-secondary hover:bg-surface-warm'
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
              className={`${ACTION} rounded-md border border-border-mid shadow-sm whitespace-nowrap`}
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

      {/* The other two things a finished lecture turns into. Secondary to the
          in-hall check, but the same idea: the deck is the source, not a
          dead end. The caption is what tells a teacher these are outputs for
          the group rather than more controls for the test above. */}
      <div className="mt-4 pt-3 border-t border-border">
        {/* ink-secondary, not the ink-tertiary most micro-captions in this app
            use: tertiary measures 2.84:1 on white, under the 4.5:1 AA floor.
            At 10px this is the caption a teacher most needs to read. */}
        <div className="text-[10px] font-sans font-semibold text-ink-secondary uppercase tracking-wider mb-2">
          Материалы для студентов
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Split button — one action, two variants. Sharing a border is what
              says «без конспекта» belongs to Раздатка; as a separate link it
              read as an unrelated third action with a missing first half. */}
          <div className="inline-flex rounded-md border border-border-mid shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => void downloadPresentationHandout(presentationId)}
              className={ACTION}
              title="PDF со слайдами и конспектом лекции — для раздачи студентам"
            >
              <Icon name="import" size={14} />
              Раздатка <span className="opacity-70">PDF</span>
            </button>
            {/* Muted, and carrying the same download icon on purpose. Without
                the icon this half reads as the unselected segment of a toggle —
                the pacing control directly above uses exactly this shape — and
                a teacher would take it for a state rather than a second
                download. The icon says "this also downloads something"; the
                warm background says "and it's the lesser variant" — the
                subordination is carried by the surface, NOT by lighter text:
                ink-tertiary on surface-warm measures 2.68:1, well under the
                4.5:1 AA floor. ink-secondary on that surface is 5.42:1. */}
            <button
              type="button"
              onClick={() => void downloadPresentationHandout(presentationId, false)}
              className={`${ACTION} border-l border-border-mid bg-surface-warm`}
              aria-label="Скачать раздатку без конспекта лекции"
              title="Только заголовки и содержание слайдов — чтобы студенты конспектировали сами"
            >
              <Icon name="import" size={13} />
              без конспекта
            </button>
          </div>

          {/* Only when there is something to write: on a generated deck every
              slide already has notes, and an always-present button would read
              as "regenerate my notes", which is not what this does. */}
          {missingNotes > 0 && (
            <button
              type="button"
              onClick={() => notesMut.mutate()}
              disabled={notesMut.isPending}
              className={`${ACTION} rounded-md border border-border-mid shadow-sm`}
              title="ИСПУМ напишет сценарий выступления к слайдам, у которых его нет. Сами слайды не меняются. Расходует одну генерацию из месячного лимита."
            >
              {notesMut.isPending
                ? <><LoadingSpinner size={12} /> Пишем заметки…</>
                : <><Icon name="sparkle" size={14} /> Написать заметки ({missingNotes})</>}
            </button>
          )}

          <button
            type="button"
            onClick={() => assignmentMut.mutate()}
            disabled={assignmentMut.isPending}
            className={`${ACTION} rounded-md border border-border-mid shadow-sm`}
            title="Вопросы со слайдов «Обсуждение» станут письменным заданием"
          >
            {assignmentMut.isPending
              ? <><LoadingSpinner size={12} /> Создаём…</>
              : <><Icon name="file-check" size={14} /> Письменная работа</>}
          </button>
        </div>
      </div>
    </div>
  )
}
