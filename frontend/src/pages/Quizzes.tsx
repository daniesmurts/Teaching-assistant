import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CopyAllButton from '../components/ui/CopyAllButton'
import BackLink from '../components/ui/BackLink'
import Icon from '../components/ui/Icon'
import Badge from '../components/ui/Badge'
import { tagColorClasses } from '../lib/tagColor'
import { Input } from '../components/ui/Input'
import { getCourses } from '../api/courses'
import NoCourseHint from '../components/onboarding/NoCourseHint'
import { generateQuiz, getQuizzes, getQuiz, deleteQuiz } from '../api/quizzes'
import { createLiveSession } from '../api/liveSessions'
import { usePlan } from '../hooks/usePlan'
import { useUIStore } from '../store/uiStore'
import type { Quiz, QuizLevel, QuizQuestion, PresentationSource, LiveSessionMode } from '../types'

const LEVEL_LABEL: Record<QuizLevel, string> = {
  recall:        'Запоминание',
  understanding: 'Понимание',
  application:   'Применение',
}

export default function Quizzes() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const { atQuizLimit, quizzesUsed, quizzesLimit } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)

  const [topic, setTopic]           = useState('')
  const [count, setCount]           = useState(10)
  const [courseId, setCourseId]     = useState('')
  const [level, setLevel]           = useState<QuizLevel | ''>('')
  const [sourceText, setSourceText] = useState('')
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'],   queryFn: getCourses })
  const { data: list = [] }    = useQuery({ queryKey: ['quizzes'],   queryFn: () => getQuizzes() })

  // Deep link from elsewhere (e.g. the ФОС studio's «Источники» panel) — a
  // ?id= opens that generated quiz directly instead of landing on the form.
  // fos_course/fos_doc (also set by that same link) power the "← Назад к
  // ФОС" back-link below, so getting back doesn't mean re-navigating the
  // whole sidebar → Материалы → ФОС → course → history path by hand.
  const [searchParams] = useSearchParams()
  const linkedId = searchParams.get('id')
  const fosCourse = searchParams.get('fos_course')
  const fosDoc = searchParams.get('fos_doc')
  const { data: linkedQuiz } = useQuery({
    queryKey: ['quiz', linkedId],
    queryFn: () => getQuiz(linkedId!),
    enabled: Boolean(linkedId),
  })
  useEffect(() => { if (linkedQuiz) setActiveQuiz(linkedQuiz) }, [linkedQuiz])

  const generateMut = useMutation({
    mutationFn: () => generateQuiz({
      topic:          topic.trim(),
      question_count: count,
      course_id:      courseId || undefined,
      level:          level || undefined,
      source_text:    sourceText.trim() || undefined,
    }),
    onSuccess: ({ quiz }) => {
      qc.invalidateQueries({ queryKey: ['quizzes'] })
      setActiveQuiz(quiz)
      setTopic('')
      setSourceText('')
    },
    onError: () => addToast('Не удалось сгенерировать тест', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteQuiz,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quizzes'] }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!topic.trim()) return
    if (atQuizLimit) { showUpgradeModal('PLAN_LIMIT_REACHED'); return }
    generateMut.mutate()
  }

  const selectClass = 'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Тесты — быстрая проверка по материалам"
        actions={activeQuiz && (
          <div className="flex items-center gap-2">
            {fosDoc && <BackLink to={`/fos?course=${fosCourse}&doc=${fosDoc}`} label="← Назад к ФОС" />}
            <Button size="sm" variant="secondary" onClick={() => setActiveQuiz(null)}>
              ← Новый тест
            </Button>
          </div>
        )}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">

          {!activeQuiz && (
            <>
              <FeatureIntro
                id="quizzes"
                title="Тесты на основе ваших учебных материалов"
                description="Введите тему — ИСПУМ соберёт 5–20 вопросов с четырьмя вариантами ответа, опираясь на загруженные программу и лекционные материалы предмета. Каждый вопрос ссылается на конкретный фрагмент источника, чтобы вы могли быстро проверить корректность."
                steps={[
                  'Выберите предмет — тогда тест будет опираться на загруженные программу и материалы.',
                  'Задайте тему и количество вопросов (5–20).',
                  'Опционально выберите когнитивный уровень: запоминание, понимание или применение.',
                  'После генерации просмотрите ответы, скопируйте текст и проверьте источники.',
                ]}
              />

              <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-3">
                <Input
                  label="Тема"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Например, классическая обусловленность"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Предмет (опционально)</label>
                    <select className={selectClass} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                      <option value="">Без привязки</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <NoCourseHint />
                  </div>
                  <div>
                    <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Количество вопросов</label>
                    <input
                      type="number" min={5} max={20}
                      value={count}
                      onChange={(e) => setCount(Math.max(5, Math.min(20, Number(e.target.value) || 10)))}
                      className={selectClass}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Когнитивный уровень (опционально)</label>
                  <select
                    className={selectClass}
                    value={level}
                    onChange={(e) => setLevel(e.target.value as QuizLevel | '')}
                  >
                    <option value="">Не выбран</option>
                    <option value="recall">Запоминание (определения, факты)</option>
                    <option value="understanding">Понимание (объяснение, сравнение)</option>
                    <option value="application">Применение (использование в задачах)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Конспект лекции (опционально)</label>
                  <textarea
                    className={`${selectClass} min-h-[100px] resize-y`}
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    placeholder="Вставьте текст конспекта — тест будет составлен строго по нему, без привязки к загруженным материалам предмета"
                    maxLength={20000}
                  />
                </div>

                <Button type="submit" className="w-full" loading={generateMut.isPending} disabled={!topic.trim() || atQuizLimit}>
                  {atQuizLimit ? 'Лимит достигнут' : 'Сгенерировать тест'}
                  {!atQuizLimit && quizzesLimit !== null && (
                    <span className="ml-2 opacity-60 text-xs">({quizzesUsed}/{quizzesLimit})</span>
                  )}
                </Button>
                {atQuizLimit && (
                  <p className="text-[11px] font-sans text-warning text-center mt-1">
                    Вы использовали все {quizzesLimit} бесплатных тестов в этом месяце.
                    <button type="button" onClick={() => showUpgradeModal('PLAN_LIMIT_REACHED')} className="text-amber font-medium ml-1 underline">
                      Перейти на Pro →
                    </button>
                  </p>
                )}
              </form>

              {/* History */}
              {list.length > 0 && (
                <div>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                    История тестов
                  </div>
                  <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    {list.map((q, i) => (
                      <div key={q.id}
                        className={`flex items-center gap-3 px-4 py-3 ${i < list.length - 1 ? 'border-b border-border' : ''}`}>
                        <button onClick={() => setActiveQuiz(q)} className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            {q.course_name && (
                              <Badge className={`flex-shrink-0 max-w-[40%] ${tagColorClasses(q.course_id ?? q.course_name)}`}>
                                {q.course_name}
                              </Badge>
                            )}
                            <div className="text-sm font-sans font-medium text-ink truncate min-w-0 flex-1">{q.topic}</div>
                          </div>
                          <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                            {q.question_count} вопросов
                            {q.level && <span> · {LEVEL_LABEL[q.level]}</span>}
                            <span> · {new Date(q.created_at).toLocaleDateString('ru-RU')}</span>
                          </div>
                        </button>
                        <button onClick={() => { if (confirm('Удалить этот тест?')) deleteMut.mutate(q.id) }}
                          className="text-xs text-ink-tertiary hover:text-danger flex-shrink-0">Удалить</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeQuiz && <QuizDisplay quiz={activeQuiz} />}
        </div>
      </div>
    </div>
  )
}

// ─── Quiz display ─────────────────────────────────────────────────────────────

function QuizDisplay({ quiz }: { quiz: Quiz }) {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [reveal, setReveal] = useState<Set<number>>(new Set())
  const [openSource, setOpenSource] = useState<PresentationSource | null>(null)
  const [liveMode, setLiveMode] = useState<LiveSessionMode>('paced')

  const launchMut = useMutation({
    mutationFn: () => createLiveSession(quiz.id, liveMode),
    onSuccess: (session) => navigate(`/live/host/${session.id}`),
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status
      const message = status === 403
        ? 'Достигнут лимит живых сессий на бесплатном тарифе в этом месяце.'
        : 'Не удалось запустить сессию'
      addToast(message, 'error')
    },
  })

  function toggle(i: number) {
    setReveal((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function revealAll() { setReveal(new Set(quiz.questions.map((_, i) => i))) }

  function copyAll() {
    const lines: string[] = [`Тест: ${quiz.topic}`, '']
    quiz.questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`)
      q.options.forEach((o, oi) => lines.push(`   ${String.fromCharCode(65 + oi)}. ${o}`))
      lines.push(`   Ответ: ${String.fromCharCode(65 + q.correct_index)}`)
      lines.push(`   Пояснение: ${q.explanation}`)
      lines.push('')
    })
    return navigator.clipboard.writeText(lines.join('\n'))
  }

  const sources = quiz.sources ?? []

  return (
    <div className="space-y-4">
      {/* Toolbar — flex-wrap so a long topic label drops the action row to
          its own line instead of squeezing it into a sliver of width. The
          action row itself also needs flex-wrap: on a narrow phone screen
          the pacing toggle + 3 buttons don't fit one line, and without wrap
          here they used to force the whole PAGE into horizontal scroll
          instead of just flowing onto a second line. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider break-words min-w-0">
          {quiz.questions.length} вопросов · {quiz.topic}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pacing choice — made once, at launch, since it changes the
              whole interaction model (shared vs. per-participant question
              pointer) rather than something togglable mid-session. */}
          <div className="inline-flex rounded-md border border-border-mid overflow-hidden shrink-0" role="group" aria-label="Темп прохождения">
            <button
              onClick={() => setLiveMode('paced')}
              className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap transition-colors ${
                liveMode === 'paced' ? 'bg-amber text-white' : 'bg-surface text-ink-secondary hover:bg-surface-warm'
              }`}
            >
              В темпе группы
            </button>
            <button
              onClick={() => setLiveMode('self_paced')}
              className={`px-2.5 py-1.5 text-xs font-sans font-medium whitespace-nowrap border-l border-border-mid transition-colors ${
                liveMode === 'self_paced' ? 'bg-amber text-white' : 'bg-surface text-ink-secondary hover:bg-surface-warm'
              }`}
            >
              В своём темпе
            </button>
          </div>
          {/* The standout action gets the primary amber treatment so it
              actually reads as the headline feature here — it used to sit
              in the same washed-out grey as the two lightweight utility
              actions next to it, indistinguishable at a glance. */}
          <Button variant="primary" size="sm" className="whitespace-nowrap" onClick={() => launchMut.mutate()} loading={launchMut.isPending}>
            {!launchMut.isPending && <Icon name="play-circle" size={14} />}
            Запустить в аудитории
          </Button>
          <button
            onClick={revealAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-border-mid text-xs font-sans font-medium text-ink-secondary shadow-sm whitespace-nowrap shrink-0 hover:border-amber hover:text-amber transition-colors"
          >
            <Icon name="check" size={13} />
            Показать все ответы
          </button>
          <CopyAllButton onCopy={copyAll} />
        </div>
      </div>

      {/* Questions */}
      {quiz.questions.map((q, i) => (
        <QuestionCard
          key={i}
          index={i}
          q={q}
          revealed={reveal.has(i)}
          onToggle={() => toggle(i)}
          sources={sources}
          onCite={setOpenSource}
        />
      ))}

      {/* Sources legend */}
      {sources.length > 0 && (
        <div className="mt-6 bg-surface border border-border rounded-lg p-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
            Использованные источники
          </div>
          <div className="space-y-2">
            {sources.map((s) => (
              <button
                key={s.idx}
                type="button"
                onClick={() => setOpenSource(s)}
                className="w-full flex items-start gap-2 text-left hover:bg-surface-warm transition-colors px-2 py-1.5 -mx-2 rounded-md"
              >
                <span className="inline-flex items-center justify-center text-[10px] font-sans font-semibold bg-amber-light text-amber w-5 h-5 rounded-sm flex-shrink-0 mt-px">
                  {s.idx}
                </span>
                <span className="text-xs font-sans text-ink-secondary leading-relaxed">
                  <span className="text-ink font-medium">{s.file_name}</span>
                  {s.page_start != null && (
                    <span className="text-ink-tertiary">
                      {' '}·{' '}
                      {s.page_end && s.page_end !== s.page_start
                        ? `стр. ${s.page_start}–${s.page_end}`
                        : `стр. ${s.page_start}`}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openSource && <SourceDetail source={openSource} onClose={() => setOpenSource(null)} />}
    </div>
  )
}

function QuestionCard({
  index, q, revealed, onToggle, sources, onCite,
}: {
  index:     number
  q:         QuizQuestion
  revealed:  boolean
  onToggle:  () => void
  sources:   PresentationSource[]
  onCite:    (s: PresentationSource) => void
}) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start gap-3">
        <span className="inline-flex items-center justify-center text-[11px] font-sans font-semibold bg-amber-light text-amber w-6 h-6 rounded-sm flex-shrink-0">
          {index + 1}
        </span>
        <p className="flex-1 text-sm font-sans text-ink leading-relaxed">{q.question}</p>
        {q.citations.length > 0 && (
          <div className="flex gap-1 flex-shrink-0">
            {q.citations.map((idx) => {
              const src = sources.find((s) => s.idx === idx)
              if (!src) return null
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onCite(src)}
                  title={src.file_name}
                  className="text-[10px] font-sans font-medium px-1.5 py-px rounded-sm bg-amber-light text-amber hover:bg-amber hover:text-white transition-colors"
                >
                  {idx}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {q.options.map((o, oi) => {
          const isAnswer = revealed && oi === q.correct_index
          return (
            <div
              key={oi}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-md ${
                isAnswer ? 'bg-success-bg' : ''
              }`}
            >
              <span className={`text-xs font-sans font-medium w-5 flex-shrink-0 mt-px ${
                isAnswer ? 'text-success' : 'text-ink-tertiary'
              }`}>
                {String.fromCharCode(65 + oi)}.
              </span>
              <span className={`text-sm font-sans leading-relaxed ${
                isAnswer ? 'text-success font-medium' : 'text-ink'
              }`}>
                {o}
              </span>
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-border flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="text-xs font-sans font-medium text-amber hover:underline flex-shrink-0"
        >
          {revealed ? 'Скрыть ответ' : 'Показать ответ'}
        </button>
        {revealed && (
          <p className="flex-1 text-xs font-sans text-ink-secondary leading-relaxed italic">
            {q.explanation}
          </p>
        )}
      </div>
    </div>
  )
}

function SourceDetail({ source, onClose }: { source: PresentationSource; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-md my-12 shadow-sm border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <span className="inline-flex items-center justify-center text-[10px] font-sans font-semibold bg-amber text-white w-5 h-5 rounded-sm flex-shrink-0">
            {source.idx}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-sans font-medium text-ink truncate">{source.file_name}</div>
            {source.page_start != null && (
              <div className="text-[11px] font-sans text-ink-tertiary">
                {source.page_end && source.page_end !== source.page_start
                  ? `Страницы ${source.page_start}–${source.page_end}`
                  : `Страница ${source.page_start}`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none ml-1" aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Фрагмент из источника
          </div>
          <p className="text-[13px] font-sans text-ink-secondary leading-relaxed whitespace-pre-wrap">
            {source.excerpt}
          </p>
        </div>
      </div>
    </div>
  )
}
