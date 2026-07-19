import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import Icon, { type IconName } from '../components/ui/Icon'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { getCourses } from '../api/courses'
import {
  createFosDocument, getFosDocument, listFosDocuments, saveFosSections, downloadFosExport,
} from '../api/fos'
import { useUIStore } from '../store/uiStore'
import type { FosDocument, FosSections, FosTicket, FosCriterion, MaterialKind } from '../types'

const KIND_LABEL: Record<MaterialKind, string> = { assignment: 'Задания', case: 'Кейсы', project: 'Проекты' }
const KIND_ICON: Record<MaterialKind, IconName> = { assignment: 'list-checks', case: 'building', project: 'layers' }

const AUTOSAVE_DEBOUNCE_MS = 1200
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 200
const STEP_LABELS = ['Темы дисциплины', 'Тест', 'Задания', 'Кейсы', 'Проекты', 'Билеты', 'Критерии']

// A few playful lines per step, cycled while that step is active — the same
// wait either way, but it reads as the system actually doing something
// rather than a frozen spinner. Purely decorative text, no motion of its own.
const STEP_QUIPS: string[][] = [
  ['Читаем программу курса…', 'Ищем ключевые темы дисциплины…'],
  ['Придумываем вопросы…', 'Подбираем варианты ответов…', 'Расставляем ловушки для невнимательных…'],
  ['Формулируем практические задания…', 'Подбираем условия позаковыристее…'],
  ['Придумываем рабочие ситуации…', 'Собираем кейсы из жизни специалиста…'],
  ['Проектируем этапы работы…', 'Формулируем ожидаемый результат…'],
  ['Собираем билеты…', 'Балансируем темы по билетам…', 'Проверяем, что билеты не повторяются…'],
  ['Прописываем критерии оценивания…', 'Сверяем шкалу «5–4–3–2»…'],
]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function FosStudio() {
  const addToast = useUIStore((s) => s.addToast)

  // Deep link back into a specific run — set by SourcesPanel's links so
  // clicking through to a generated test/task, then navigating back, lands
  // exactly where the teacher left off instead of a blank course picker.
  const [searchParams] = useSearchParams()
  const [courseId, setCourseId] = useState(() => searchParams.get('course') ?? '')
  const [doc, setDoc]           = useState<FosDocument | null>(null)
  const [sections, setSections] = useState<FosSections | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const disciplineName = courses.find((c) => c.id === courseId)?.name ?? ''

  const historyQuery = useQuery({
    queryKey: ['fos-documents', courseId],
    queryFn: () => listFosDocuments(courseId),
    enabled: Boolean(courseId),
  })

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  // Which document id is currently being actively polled — guards against
  // starting a second overlapping poll loop for the same or a different doc.
  const pollingId = useRef<string | null>(null)

  useEffect(() => {
    setDoc(null)
    setSections(null)
    cancelled.current = true   // stop any poll loop from the previous course
    pollingId.current = null
  }, [courseId])

  // The pg-boss job keeps running server-side regardless of whether this tab
  // is open — a page refresh or navigating away never loses generation
  // progress. What WAS missing is the frontend picking the live view back
  // up: on load (or whenever the history list changes), a ?doc= deep link
  // (from SourcesPanel's back-links) opens that exact run; failing that, a
  // still-running document for this course resumes polling automatically
  // instead of leaving the teacher looking at a static "собирается" row
  // they'd have to click to refresh by hand.
  useEffect(() => {
    if (!historyQuery.data || doc) return

    const wantedId = searchParams.get('doc')
    const wanted = wantedId ? historyQuery.data.find((d) => d.id === wantedId) : null
    if (wanted) {
      setDoc(wanted)
      setSections(wanted.sections)
      if (wanted.status === 'pending' || wanted.status === 'processing') poll(wanted.id)
      return
    }

    const inFlight = historyQuery.data.find((d) => d.status === 'pending' || d.status === 'processing')
    if (inFlight) {
      setDoc(inFlight)
      poll(inFlight.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery.data])

  const createMut = useMutation({
    mutationFn: () => createFosDocument({ courseId }),
    onSuccess: (created) => {
      cancelled.current = false
      setDoc(created)
      setSections(null)
      poll(created.id)
    },
  })

  async function poll(id: string) {
    cancelled.current = false
    pollingId.current = id
    // Fetch immediately on (re)entry — resuming after a refresh shouldn't
    // wait a full interval to show where the job actually stands.
    for (let i = 0; i < MAX_POLLS && !cancelled.current && pollingId.current === id; i++) {
      const latest = await getFosDocument(id)
      if (cancelled.current || pollingId.current !== id) return
      setDoc(latest)
      if (latest.status === 'ready') {
        setSections(latest.sections)
        historyQuery.refetch()
        return
      }
      if (latest.status === 'failed') {
        addToast(latest.error_message || 'Не удалось собрать ФОС', 'error')
        return
      }
      await delay(POLL_INTERVAL_MS)
    }
  }

  function openHistoryItem(item: FosDocument) {
    setDoc(item)
    setSections(item.sections)
    if (item.status === 'pending' || item.status === 'processing') poll(item.id)
  }

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function persistSections(next: FosSections) {
    if (!doc) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      saveFosSections(doc.id, next).catch(() => null)
    }, AUTOSAVE_DEBOUNCE_MS)
  }
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }, [])

  function editTicket(i: number, patch: Partial<FosTicket>) {
    setSections((prev) => {
      if (!prev) return prev
      const tickets = prev.tickets.map((t, idx) => idx === i ? { ...t, ...patch } : t)
      const next = { ...prev, tickets }
      persistSections(next)
      return next
    })
  }

  function editCriterion(i: number, patch: Partial<FosCriterion>) {
    setSections((prev) => {
      if (!prev) return prev
      const criteria = prev.criteria.map((c, idx) => idx === i ? { ...c, ...patch } : c)
      const next = { ...prev, criteria }
      persistSections(next)
      return next
    })
  }

  const isGenerating = doc && (doc.status === 'pending' || doc.status === 'processing')

  return (
    <div className="flex flex-col h-full">
      <TopBar title="ФОС" subtitle="Фонд оценочных средств" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[860px] mx-auto page-enter space-y-4">
          <FeatureIntro
            id="fos-studio"
            title="Как это работает"
            description="Выберите дисциплину — ИСПУМ соберёт фонд оценочных средств: тесты, практические задания/кейсы/проекты, экзаменационные билеты и критерии оценивания, по темам курса. Каждый раздел можно отредактировать; итоговый документ скачивается в DOCX или PDF."
            steps={[
              'Выберите дисциплину с заполненной программой (аннотацией)',
              'ИСПУМ последовательно собирает разделы ФОС — прогресс виден на экране',
              'Отредактируйте билеты и критерии, проверьте покрытие тем, скачайте документ',
            ]}
          />

          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-sm font-sans font-medium text-ink">Дисциплина</span>
            </div>
            {courses.length === 0 ? (
              <div className="p-4 text-sm font-sans text-ink-secondary">
                Сначала добавьте дисциплину в разделе «Предметы».
              </div>
            ) : (
              <div className="p-4">
                <select
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink focus:outline-none focus:border-border-strong"
                >
                  <option value="">— выберите дисциплину —</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="px-4 py-3 border-t border-border flex items-center gap-3">
              <Button onClick={() => createMut.mutate()} loading={createMut.isPending || Boolean(isGenerating)} disabled={!courseId}>
                Собрать ФОС
              </Button>
              <span className="text-xs font-sans text-ink-tertiary">Может занять несколько минут</span>
            </div>
          </div>

          {historyQuery.data && historyQuery.data.length > 0 && (
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-xs font-sans font-medium text-ink-secondary mb-2">История</div>
              <div className="flex flex-col gap-1">
                {historyQuery.data.map((item) => {
                  const live = item.status === 'pending' || item.status === 'processing'
                  const isOpen = doc?.id === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => openHistoryItem(item)}
                      className={`flex items-center gap-2 text-left px-2 py-2 rounded transition-colors ${
                        isOpen ? 'bg-amber-light/60' : 'hover:bg-surface-warm'
                      }`}
                    >
                      {live && <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse motion-reduce:animate-none shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-xs font-sans font-medium text-ink truncate">{historyTitle(item)}</div>
                        <div className="text-[11px] font-sans text-ink-tertiary">{new Date(item.created_at).toLocaleString('ru-RU')}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isGenerating && doc && (
            <FosProgressTimeline doc={doc} />
          )}

          {sections && doc?.status === 'ready' && (
            <div className="result-appear space-y-4">
              <CoverageBanner doc={doc} />

              <ExportButtons docId={doc.id} />

              <SourcesPanel sections={sections} courseId={courseId} docId={doc.id} />

              <PassportSection sections={sections} disciplineName={disciplineName} />
              <TicketsSection tickets={sections.tickets} onEdit={editTicket} />
              <CriteriaSection criteria={sections.criteria} onEdit={editCriterion} />

              <p className="text-xs font-sans text-ink-tertiary">
                ИСПУМ помогает с черновиком — итоговый ФОС утверждает преподаватель.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// A history row used to just say "17.07.2026, 07:21 — готов" for every
// finished run — indistinguishable from any other run that same day. Once a
// document is ready, name it by what's actually inside instead of repeating
// the status word on every row.
function historyTitle(item: FosDocument): string {
  if (item.status === 'pending') return 'Ожидает очереди…'
  if (item.status === 'processing') return `Собирается — ${STEP_LABELS[Math.min(item.progress_done, STEP_LABELS.length - 1)]}…`
  if (item.status === 'failed') return item.error_message ? `Ошибка: ${item.error_message}` : 'Ошибка сборки'

  const s = item.sections
  if (!s) return 'Готово'
  const parts: string[] = []
  if (s.tickets.length > 0) parts.push(`${s.tickets.length} ${pluralRu(s.tickets.length, 'билет', 'билета', 'билетов')}`)
  if (s.criteria.length > 0) parts.push(`${s.criteria.length} ${pluralRu(s.criteria.length, 'критерий', 'критерия', 'критериев')}`)
  return parts.length > 0 ? parts.join(', ') : 'Готово'
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few
  return many
}

// Multi-step progress — a filled step timeline instead of a bare spinner +
// text, plus a rotating status line so a several-minute wait reads as work
// actually happening rather than a stalled request. Every visible motion
// (the pulse ring, the connector fill, the quip crossfade) is driven by real
// state changes on a ~3s poll cadence, not a decorative loop, and everything
// backs off under prefers-reduced-motion (motion-reduce:).
function FosProgressTimeline({ doc }: { doc: FosDocument }) {
  const total = Math.max(doc.progress_total, STEP_LABELS.length)
  const done = Math.min(doc.progress_done, total)
  const activeIndex = Math.min(done, STEP_LABELS.length - 1)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const quips = STEP_QUIPS[activeIndex] ?? ['Готовим ФОС…']
  const [quipIndex, setQuipIndex] = useState(0)

  useEffect(() => {
    setQuipIndex(0)
    if (quips.length <= 1) return
    const id = setInterval(() => setQuipIndex((i) => (i + 1) % quips.length), 2500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <div className="bg-surface border border-border rounded-lg p-6 result-appear">
      <div className="flex items-baseline justify-between mb-5">
        <span className="text-sm font-sans font-medium text-ink">Собираем ФОС</span>
        <span className="text-sm font-serif font-bold text-amber tabular-nums">{pct}%</span>
      </div>

      {/* Step circles + connectors */}
      <div className="flex items-center mb-4">
        {STEP_LABELS.map((label, i) => {
          const isDone = i < activeIndex
          const isActive = i === activeIndex
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 w-14 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors duration-300 ${
                    isDone
                      ? 'bg-success text-white'
                      : isActive
                        ? 'bg-amber text-white ring-4 ring-amber/20 animate-pulse motion-reduce:animate-none'
                        : 'bg-surface-warm text-ink-tertiary border border-border-mid'
                  }`}
                >
                  {isDone ? <Icon name="check" size={14} /> : <span className="text-[11px] font-sans font-medium">{i + 1}</span>}
                </div>
                <span className={`text-[10px] font-sans text-center leading-tight ${isActive ? 'text-ink font-medium' : 'text-ink-tertiary'}`}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className="flex-1 h-0.5 rounded-full bg-border-mid overflow-hidden -mt-4">
                  <div
                    className="h-full bg-success transition-[width] duration-500 ease-out"
                    style={{ width: isDone ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p key={quipIndex} className="text-center text-xs font-sans text-ink-secondary animate-[fadeIn_400ms_ease] motion-reduce:animate-none">
        {quips[quipIndex]}
      </p>
    </div>
  )
}

function CoverageBanner({ doc }: { doc: FosDocument }) {
  const coverage = doc.coverage
  if (!coverage) return null
  const warnings = [
    ...coverage.topics_uncovered.map((t) => `Тема без оценочного средства: «${t}»`),
    ...coverage.competencies_uncovered.map((c) => `Компетенция не отражена: «${c}»`),
    ...(coverage.balance_warning ? [coverage.balance_warning] : []),
  ]
  if (warnings.length === 0) {
    return (
      <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-xs font-sans text-success">
        Все темы отражены хотя бы в одном оценочном средстве.
      </div>
    )
  }
  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
      <div className="text-xs font-sans font-medium text-warning mb-1.5">Замечания по покрытию</div>
      <ul className="space-y-1">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs font-sans text-ink-secondary">· {w}</li>
        ))}
      </ul>
    </div>
  )
}

const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
)

// Plain outlined buttons read as a near-transparent ghost pill here — this is
// the deliverable action for the whole page, so it needs to look like an
// obvious, clickable download rather than blend into the surrounding cards.
// Same "solid surface + border + icon + shadow" fix already used for the
// same complaint on the programme-analysis PDF export
// (institution/InstitutionProgramDetail.tsx).
function ExportButtons({ docId }: { docId: string }) {
  const [downloading, setDownloading] = useState<'docx' | 'pdf' | null>(null)

  async function handleDownload(format: 'docx' | 'pdf') {
    setDownloading(format)
    try {
      await downloadFosExport(docId, format)
    } finally {
      setDownloading(null)
    }
  }

  const btnClass = 'inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-surface border border-border-mid text-ink text-sm font-sans font-medium shadow-sm hover:border-amber hover:text-amber transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="flex items-center justify-end gap-2">
      <button className={btnClass} disabled={downloading !== null} onClick={() => handleDownload('docx')}>
        {downloading === 'docx' ? <LoadingSpinner size={15} /> : <DownloadIcon />}
        Скачать DOCX
      </button>
      <button className={btnClass} disabled={downloading !== null} onClick={() => handleDownload('pdf')}>
        {downloading === 'pdf' ? <LoadingSpinner size={15} /> : <DownloadIcon />}
        Скачать PDF
      </button>
    </div>
  )
}

// Тесты and задания/кейсы/проекты are generated by the existing standalone
// generators, not stored inline in the ФОС — this used to be a one-line
// footnote at the very bottom of the page, easy to miss entirely. Promoted
// to a proper card right under the export buttons, with real links straight
// to each generated item (?id= deep link, opened by Quizzes.tsx /
// MaterialGenerator.tsx) instead of just naming the section to go look in.
//
// Each link also carries a back-reference (fos_course/fos_doc) so the target
// page can show a "← Назад к ФОС" link straight back to this exact run —
// otherwise getting back means sidebar → Материалы → ФОС → re-pick the
// course → re-pick the run from history, every single time.
function SourcesPanel({ sections, courseId, docId }: { sections: FosSections; courseId: string; docId: string }) {
  const back = `fos_course=${courseId}&fos_doc=${docId}`
  const quizLinks = sections.quiz_ids.map((id, i) => ({
    key: `quiz-${id}`,
    to: `/quizzes?id=${id}&${back}`,
    // Not 'quiz' — that icon's silhouette (a rounded rect containing a
    // question-mark squiggle) reads as a generic "missing icon" placeholder
    // at chip size, easily mistaken for a broken render. file-check (a
    // document + checkmark) is unambiguous at the same size.
    icon: 'file-check' as IconName,
    label: sections.quiz_ids.length > 1 ? `Тест ${i + 1}` : 'Тест',
  }))
  const taskLinks = sections.task_sets.map((t) => ({
    key: `task-${t.id}`,
    to: `/materials/${t.kind}?id=${t.id}&${back}`,
    icon: KIND_ICON[t.kind],
    label: KIND_LABEL[t.kind],
  }))
  const links = [...quizLinks, ...taskLinks]
  if (links.length === 0) return null

  return (
    <div className="bg-amber-light/60 border border-amber-mid/30 rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink mb-2.5">
        Тесты и задания сформированы отдельно — открыть и отредактировать:
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link
            key={l.key}
            to={l.to}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-border-mid text-xs font-sans font-medium text-ink hover:border-amber hover:text-amber transition-colors"
          >
            <Icon name={l.icon} size={16} />
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function PassportSection({ sections, disciplineName }: { sections: FosSections; disciplineName: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface-warm">
        <span className="text-sm font-sans font-medium text-ink">Паспорт ФОС — {disciplineName}</span>
      </div>
      <div className="p-4 overflow-x-auto">
        {sections.passport.competencies.length > 0 && (
          <div className="text-xs font-sans text-ink-secondary mb-3">
            Компетенции: {sections.passport.competencies.join(', ')}
          </div>
        )}
        <table className="w-full text-xs font-sans">
          <thead>
            <tr className="text-left text-ink-tertiary border-b border-border">
              <th className="pb-2 pr-3 font-medium">Тема</th>
              <th className="pb-2 font-medium">Оценочные средства</th>
            </tr>
          </thead>
          <tbody>
            {sections.passport.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2 pr-3 text-ink align-top">{row.topic}</td>
                <td className={`py-2 align-top ${row.instruments.length > 0 ? 'text-ink-secondary' : 'text-warning'}`}>
                  {row.instruments.length > 0 ? row.instruments.join('; ') : '— не покрыто —'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TicketsSection({ tickets, onEdit }: { tickets: FosTicket[]; onEdit: (i: number, patch: Partial<FosTicket>) => void }) {
  if (tickets.length === 0) return null
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface-warm">
        <span className="text-sm font-sans font-medium text-ink">Экзаменационные билеты ({tickets.length})</span>
      </div>
      <div className="divide-y divide-border">
        {tickets.map((t, i) => (
          <div key={i} className="p-4 space-y-2">
            <div className="text-sm font-sans font-medium text-ink">Билет №{t.number}</div>
            {t.theory_questions.map((q, qi) => (
              <textarea
                key={qi}
                value={q}
                onChange={(e) => {
                  const questions = t.theory_questions.map((x, idx) => idx === qi ? e.target.value : x)
                  onEdit(i, { theory_questions: questions })
                }}
                rows={2}
                className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm rounded-md resize-y focus:outline-none"
              />
            ))}
            <textarea
              value={t.practical_task}
              onChange={(e) => onEdit(i, { practical_task: e.target.value })}
              rows={2}
              placeholder="Практическое задание"
              className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm rounded-md resize-y focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function CriteriaSection({ criteria, onEdit }: { criteria: FosCriterion[]; onEdit: (i: number, patch: Partial<FosCriterion>) => void }) {
  if (criteria.length === 0) return null
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface-warm">
        <span className="text-sm font-sans font-medium text-ink">Критерии оценивания</span>
      </div>
      <div className="divide-y divide-border">
        {criteria.map((c, i) => (
          <div key={i} className="p-4 space-y-2">
            <input
              value={c.title}
              onChange={(e) => onEdit(i, { title: e.target.value })}
              className="w-full px-3 py-1.5 text-sm font-sans font-medium text-ink bg-surface-warm rounded-md focus:outline-none"
            />
            {c.scale.map((s, si) => (
              <div key={si} className="flex items-start gap-2">
                <span className="text-xs font-sans font-medium text-ink-tertiary pt-1.5 w-6 shrink-0">{s.grade}</span>
                <textarea
                  value={s.description}
                  onChange={(e) => {
                    const scale = c.scale.map((x, idx) => idx === si ? { ...x, description: e.target.value } : x)
                    onEdit(i, { scale })
                  }}
                  rows={1}
                  className="flex-1 px-2 py-1.5 text-xs font-sans text-ink-secondary bg-surface-warm rounded-md resize-y focus:outline-none"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
