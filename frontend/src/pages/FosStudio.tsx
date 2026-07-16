import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import {
  createFosDocument, getFosDocument, listFosDocuments, saveFosSections, downloadFosExport,
} from '../api/fos'
import { useUIStore } from '../store/uiStore'
import type { FosDocument, FosSections, FosTicket, FosCriterion } from '../types'

const AUTOSAVE_DEBOUNCE_MS = 1200
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 200
const STEP_LABELS = ['Темы дисциплины', 'Тест', 'Задания', 'Кейсы', 'Проекты', 'Билеты', 'Критерии']

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function FosStudio() {
  const addToast = useUIStore((s) => s.addToast)

  const [courseId, setCourseId] = useState('')
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

  useEffect(() => {
    setDoc(null)
    setSections(null)
  }, [courseId])

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
    for (let i = 0; i < MAX_POLLS && !cancelled.current; i++) {
      await delay(POLL_INTERVAL_MS)
      const latest = await getFosDocument(id)
      setDoc(latest)
      if (latest.status === 'ready') {
        setSections(latest.sections)
        historyQuery.refetch()
        break
      }
      if (latest.status === 'failed') {
        addToast(latest.error_message || 'Не удалось собрать ФОС', 'error')
        break
      }
    }
  }

  function openHistoryItem(item: FosDocument) {
    setDoc(item)
    setSections(item.sections)
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
                {historyQuery.data.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openHistoryItem(item)}
                    className="text-left text-xs font-sans text-ink-secondary hover:text-ink px-2 py-1.5 rounded hover:bg-surface-warm transition-colors"
                  >
                    {new Date(item.created_at).toLocaleString('ru-RU')} — {statusLabel(item.status)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isGenerating && doc && (
            <div className="text-center py-8 text-sm font-sans text-ink-secondary">
              {STEP_LABELS[Math.min(doc.progress_done, STEP_LABELS.length - 1)] ?? 'Готовим ФОС'}…
              {doc.progress_total > 0 && ` (${doc.progress_done} из ${doc.progress_total})`}
            </div>
          )}

          {sections && doc?.status === 'ready' && (
            <div className="result-appear space-y-4">
              <CoverageBanner doc={doc} />

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => downloadFosExport(doc.id, 'docx')}>
                  Скачать DOCX
                </Button>
                <Button variant="secondary" size="sm" onClick={() => downloadFosExport(doc.id, 'pdf')}>
                  Скачать PDF
                </Button>
              </div>

              <PassportSection sections={sections} disciplineName={disciplineName} />
              <TicketsSection tickets={sections.tickets} onEdit={editTicket} />
              <CriteriaSection criteria={sections.criteria} onEdit={editCriterion} />

              <p className="text-xs font-sans text-ink-tertiary">
                Тесты и задания сформированы отдельными генераторами и доступны в разделах «Тесты» и «Материалы».
                ИСПУМ помогает с черновиком — итоговый ФОС утверждает преподаватель.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function statusLabel(status: FosDocument['status']): string {
  return { pending: 'ожидает', processing: 'собирается', ready: 'готов', failed: 'ошибка' }[status]
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
