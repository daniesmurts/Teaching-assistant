import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import Icon, { type IconName } from '../../components/ui/Icon'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SyllabusReviewReport from '../../components/curriculum/SyllabusReviewReport'
import OverlapReport from '../../components/curriculum/OverlapReport'
import { PlacementReviewPanel, MtoReviewPanel, CoverageItemRow, CoverageChip, countByStatus } from '../../components/curriculum/CheckPanels'
import { listPrograms, getProgram, getDisciplineReviews, getPlacementReviews, getMtoReviews } from '../../api/programs'
import { analyzeProgramOverlap } from '../../api/curriculum'
import { createMethodistRun, getMethodistRun, type MethodistCheckKey, type MethodistRun } from '../../api/methodist'
import { useUIStore } from '../../store/uiStore'
import { useSessionStorageState } from '../../hooks/useSessionStorageState'
import type {
  SyllabusReview, CurriculumAnalysis, ProgramDocumentReview, ProgramPlacementReview, ProgramMtoReview,
} from '../../types'

// Кабинет методиста (TODO.md Feature AM) — one place to run the РПД/ОП
// checks a методист/УМУ role needs, without borrowing a teacher's personal
// course. Every target is a programme + discipline this role already has
// read access to (via GET /api/institution/programs — the same scope
// /programs already resolves). «Проверка дисциплины» runs asynchronously
// (Phase 2, services/methodist/checks.ts + runWorker.ts — up to 4
// independent LLM calls, too slow to hold a request open for): POST enqueues
// a pg-boss job and returns a 'queued' run row, the client polls it. Each
// check persists to the SAME table the equivalent programme-page action
// already writes (program_document_reviews / program_placement_reviews /
// program_mto_reviews) — the run row only carries pointers, so once ready
// the full result is re-fetched from those tables by id, except syllabus
// (no dedicated table anywhere in the codebase) which travels inline.
//
// Layout: a left controls / right results split (same pattern as
// Grading.tsx — fixed-width form panel, flex-1 scrollable result panel,
// both independently scrolling), not a single long stacked column. On
// mobile the two panels become tab-switched views so the picker never
// buries the button, and the button never buries the report.

type Tab = 'discipline' | 'overlap'
type MobileView = 'form' | 'result'

const CHECK_LABEL: Record<MethodistCheckKey, string> = {
  syllabus:  'Покрытие содержания по разделам (§5–§8)',
  coverage:  'Соответствие компетенциям',
  placement: 'Место дисциплины в структуре ОП (§2)',
  mto:       'Материально-техническое обеспечение (§12)',
}
const ALL_CHECKS: MethodistCheckKey[] = ['syllabus', 'coverage', 'placement', 'mto']
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 100
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function InstitutionMethodist() {
  const [tab, setTab] = useState<Tab>('discipline')
  const [programId, setProgramId] = useSessionStorageState('methodist:programId', '')

  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: listPrograms })
  const { data: program, isLoading: loadingProgram } = useQuery({
    queryKey: ['program', programId],
    queryFn: () => getProgram(programId),
    enabled: !!programId,
  })

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-6 border-b border-border flex-shrink-0 bg-surface">
        <h1 className="font-display text-2xl font-bold text-ink">Кабинет методиста</h1>
        <p className="text-xs font-sans text-ink-tertiary mt-1">
          Проверка РПД и образовательных программ — без создания личного предмета.
        </p>

        <div className="flex items-end justify-between gap-4 flex-wrap mt-4">
          <div className="flex gap-1">
            <TabButton icon="file-check" active={tab === 'discipline'} onClick={() => setTab('discipline')}>
              Проверка дисциплины
            </TabButton>
            <TabButton icon="layers" active={tab === 'overlap'} onClick={() => setTab('overlap')}>
              Пересечение содержания
            </TabButton>
          </div>

          <label className="flex flex-col gap-1 pb-2 min-w-[260px]">
            <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary">
              Образовательная программа
            </span>
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              disabled={programs.length === 0}
              className="px-3 py-1.5 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink focus:outline-none focus:border-border-strong disabled:text-ink-tertiary"
            >
              <option value="">
                {programs.length === 0 ? 'Нет доступных программ' : '— выберите программу —'}
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className={tab === 'discipline' ? 'h-full' : 'hidden'}>
          <DisciplineChecksTab programId={programId} program={program} loadingProgram={loadingProgram} />
        </div>
        <div className={tab === 'overlap' ? 'h-full' : 'hidden'}>
          <OverlapCheckTab programId={programId} program={program} loadingProgram={loadingProgram} />
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: IconName; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 -mb-px text-sm font-sans font-medium border-b-2 transition-colors ${
        active ? 'border-amber text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
      }`}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  )
}

function MobileSubtabs({ view, onChange }: { view: MobileView; onChange: (v: MobileView) => void }) {
  const cls = (v: MobileView) =>
    `flex-1 py-2 text-xs font-sans font-medium transition-colors border-b-2 ${
      view === v ? 'border-amber text-amber' : 'border-transparent text-ink-secondary'
    }`
  return (
    <div className="md:hidden flex border-b border-border bg-surface flex-shrink-0">
      <button className={cls('form')} onClick={() => onChange('form')}>Настройка</button>
      <button className={cls('result')} onClick={() => onChange('result')}>Результат</button>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
      <div className="w-11 h-11 rounded-full bg-surface-warm border border-border flex items-center justify-center text-ink-tertiary mb-3">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-sm font-sans text-ink-secondary max-w-xs">{text}</p>
    </div>
  )
}

type ProgramWithDisciplines = {
  disciplines: { id?: string; name: string }[]
  documents?: { kind: string; discipline_id: string | null; superseded_at: string | null }[]
} | undefined

// A discipline is checkable only once a CURRENT (not superseded) working
// programme document is attached to it — every check here reads that
// document's text, so this is the one thing worth surfacing before the
// picker, not after a run comes back with "no РПД" for every check.
function disciplinesWithRpd(program: ProgramWithDisciplines): Set<string> {
  const ids = new Set<string>()
  for (const doc of program?.documents ?? []) {
    if (doc.kind === 'working_programme' && doc.discipline_id && !doc.superseded_at) ids.add(doc.discipline_id)
  }
  return ids
}

function RpdBadge({ hasRpd }: { hasRpd: boolean }) {
  return hasRpd ? (
    <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm bg-success-bg text-success flex-shrink-0">РПД загружена</span>
  ) : (
    <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm bg-surface-warm text-ink-tertiary border border-border flex-shrink-0">нет РПД</span>
  )
}

function DisciplinePicker({
  program, loadingProgram, disciplineId, onChange,
}: {
  program: ProgramWithDisciplines; loadingProgram: boolean; disciplineId: string; onChange: (id: string) => void
}) {
  if (loadingProgram) return <div className="text-xs font-sans text-ink-tertiary py-1">Загрузка дисциплин…</div>
  const withRpd = disciplinesWithRpd(program)
  const selected = program?.disciplines.find((d) => d.id === disciplineId)
  return (
    <div className="space-y-1.5">
      <select
        value={disciplineId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink focus:outline-none focus:border-border-strong"
        disabled={!program || program.disciplines.length === 0}
      >
        <option value="">
          {program && program.disciplines.length === 0 ? 'В программе нет дисциплин' : '— выберите дисциплину —'}
        </option>
        {program?.disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}{d.id && !withRpd.has(d.id) ? ' — нет РПД' : ''}
          </option>
        ))}
      </select>
      {selected?.id && !withRpd.has(selected.id) && (
        <div className="text-xs font-sans text-warning bg-warning-bg border border-warning/15 rounded-md px-2.5 py-1.5">
          У этой дисциплины нет загруженной рабочей программы — проверки, которым нужен текст РПД, вернут ошибку.
        </div>
      )}
    </div>
  )
}

function CoverageResultPanel({ review }: { review: ProgramDocumentReview }) {
  const counts = countByStatus(review.result.items)
  return (
    <div className="space-y-3 text-xs font-sans">
      <div className="flex items-center gap-3">
        <CoverageChip label="раскрыто" value={counts.covered} status="covered" />
        <CoverageChip label="частично" value={counts.partial} status="partial" />
        <CoverageChip label="не раскрыто" value={counts.missing} status="missing" />
      </div>
      <p className="text-ink-secondary leading-relaxed">{review.result.summary}</p>
      <div className="space-y-2">
        {review.result.items.map((it, i) => <CoverageItemRow key={i} it={it} />)}
      </div>
    </div>
  )
}

function CheckSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-sm font-sans font-medium text-ink">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function DisciplineChecksTab({
  programId, program, loadingProgram,
}: { programId: string; program: ProgramWithDisciplines; loadingProgram: boolean }) {
  const addToast = useUIStore((s) => s.addToast)

  const [disciplineId, setDisciplineId] = useSessionStorageState('methodist:disciplineId', '')
  const [selected, setSelected] = useSessionStorageState<MethodistCheckKey[]>('methodist:checks:selected', ALL_CHECKS)
  const [mobileView, setMobileView] = useState<MobileView>('form')

  const [syllabusResult, setSyllabusResult]   = useSessionStorageState<SyllabusReview | null>('methodist:result:syllabus', null)
  const [coverageResult, setCoverageResult]   = useSessionStorageState<ProgramDocumentReview | null>('methodist:result:coverage', null)
  const [placementResult, setPlacementResult] = useSessionStorageState<ProgramPlacementReview | null>('methodist:result:placement', null)
  const [mtoResult, setMtoResult]             = useSessionStorageState<ProgramMtoReview | null>('methodist:result:mto', null)
  const [checkErrors, setCheckErrors] = useState<Partial<Record<MethodistCheckKey, string>>>({})
  const [runStatus, setRunStatus] = useState<'idle' | 'processing' | 'ready' | 'failed'>('idle')

  // Guards a stale poll loop (e.g. a second «Запустить» click, or leaving
  // the tab and coming back) from clobbering a newer run's results —
  // mirrors FosStudio.tsx's poll cancellation pattern exactly.
  const pollingId = useRef<string | null>(null)

  async function resolveResults(run: MethodistRun) {
    const errors: Partial<Record<MethodistCheckKey, string>> = {}
    for (const outcome of run.checks ?? []) {
      if (outcome.status === 'error') { errors[outcome.key] = outcome.error ?? 'Не удалось выполнить проверку'; continue }
      if (outcome.key === 'syllabus') { setSyllabusResult(outcome.result as SyllabusReview); continue }
      if (!outcome.result_id) continue
      if (outcome.key === 'coverage') {
        const found = (await getDisciplineReviews(programId)).find((r) => r.id === outcome.result_id)
        if (found) setCoverageResult(found)
      } else if (outcome.key === 'placement') {
        const found = (await getPlacementReviews(programId)).find((r) => r.id === outcome.result_id)
        if (found) setPlacementResult(found)
      } else if (outcome.key === 'mto') {
        const found = (await getMtoReviews(programId)).find((r) => r.id === outcome.result_id)
        if (found) setMtoResult(found)
      }
    }
    setCheckErrors(errors)
  }

  async function poll(id: string) {
    pollingId.current = id
    for (let i = 0; i < MAX_POLLS && pollingId.current === id; i++) {
      const run = await getMethodistRun(id)
      if (pollingId.current !== id) return
      if (run.status === 'ready') {
        setRunStatus('ready')
        await resolveResults(run)
        return
      }
      if (run.status === 'failed') {
        setRunStatus('failed')
        addToast(run.error_message || 'Не удалось выполнить проверки', 'error')
        return
      }
      await delay(POLL_INTERVAL_MS)
    }
  }

  const createMut = useMutation({
    mutationFn: () => createMethodistRun(programId, disciplineId, selected),
    onSuccess: (run) => { setRunStatus('processing'); poll(run.id) },
  })

  const running = createMut.isPending || runStatus === 'processing'
  const hasResults = !!(coverageResult || placementResult || mtoResult || syllabusResult)
  const hasErrors = Object.keys(checkErrors).length > 0

  function toggle(key: MethodistCheckKey) {
    setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  function run() {
    if (!programId || !disciplineId) { addToast('Выберите программу и дисциплину', 'error'); return }
    if (selected.length === 0) { addToast('Выберите хотя бы одну проверку', 'error'); return }
    if (!disciplinesWithRpd(program).has(disciplineId)) {
      addToast('У этой дисциплины нет загруженной рабочей программы — сначала загрузите её.', 'error')
      return
    }
    pollingId.current = null   // cancel any in-flight poll from a previous click
    setRunStatus('idle')
    setSyllabusResult(null); setCoverageResult(null); setPlacementResult(null); setMtoResult(null)
    setCheckErrors({})
    setMobileView('result')
    createMut.mutate()
  }

  return (
    <div className="h-full flex flex-col">
      <MobileSubtabs view={mobileView} onChange={setMobileView} />

      <div className="flex-1 flex overflow-hidden">
        {/* Controls panel */}
        <div className={`
          md:w-[340px] md:flex-shrink-0 md:border-r md:border-border md:flex bg-surface-warm overflow-y-auto flex-col
          ${mobileView === 'form' ? 'flex w-full' : 'hidden'} md:flex
        `}>
          <div className="p-4 space-y-4">
            <FeatureIntro
              id="methodist-cabinet-discipline"
              title="Как это работает"
              description="Выберите дисциплину и отметьте нужные проверки — каждая работает с уже загруженной рабочей программой дисциплины, без создания личного предмета."
              steps={[
                'Выберите программу, дисциплину и проверки (нужна загруженная рабочая программа)',
                'Проверки выполняются в фоне и появляются по готовности',
                'Все находки — с цитатой источника и рекомендацией',
              ]}
            />

            {!programId ? (
              <p className="text-sm font-sans text-ink-secondary">Сначала выберите программу вверху страницы.</p>
            ) : (
              <>
                <div>
                  <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary mb-1.5">
                    Дисциплина
                  </div>
                  <DisciplinePicker
                    program={program} loadingProgram={loadingProgram} disciplineId={disciplineId}
                    onChange={(id) => { setDisciplineId(id) }}
                  />
                </div>

                <div>
                  <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary mb-1.5">
                    Проверки
                  </div>
                  <div className="space-y-1">
                    {ALL_CHECKS.map((key) => (
                      <label key={key} className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-md cursor-pointer hover:bg-surface transition-colors">
                        <input
                          type="checkbox"
                          checked={selected.includes(key)}
                          onChange={() => toggle(key)}
                          className="accent-amber w-4 h-4 flex-shrink-0"
                        />
                        <span className="text-sm font-sans text-ink leading-snug">{CHECK_LABEL[key]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-1 space-y-2">
                  <Button
                    onClick={run} loading={running} disabled={!programId || !disciplineId || selected.length === 0}
                    className="w-full justify-center"
                  >
                    Запустить проверки
                  </Button>
                  <p className="text-xs font-sans text-ink-tertiary text-center">Проверки выполняются в фоне, до минуты каждая</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Results panel */}
        <div className={`
          flex-1 bg-surface overflow-y-auto flex-col
          ${mobileView === 'result' ? 'flex' : 'hidden'} md:flex
        `}>
          {running ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
              <LoadingSpinner size={20} />
              <p className="text-sm font-sans text-ink-secondary mt-3">Выполняем выбранные проверки…</p>
            </div>
          ) : !hasResults && !hasErrors ? (
            <EmptyState icon="file-check" text="Выберите дисциплину и запустите проверки — результаты появятся здесь." />
          ) : (
            <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto w-full">
              {Object.entries(checkErrors).map(([key, message]) => (
                <div key={key} className="bg-danger-bg border border-danger/15 rounded-lg p-3 text-xs font-sans text-danger">
                  <span className="font-medium">{CHECK_LABEL[key as MethodistCheckKey]}: </span>{message}
                </div>
              ))}

              {selected.includes('coverage') && coverageResult && (
                <CheckSection title={CHECK_LABEL.coverage}><CoverageResultPanel review={coverageResult} /></CheckSection>
              )}
              {selected.includes('placement') && placementResult && (
                <CheckSection title={CHECK_LABEL.placement}><PlacementReviewPanel review={placementResult} /></CheckSection>
              )}
              {selected.includes('mto') && mtoResult && (
                <CheckSection title={CHECK_LABEL.mto}><MtoReviewPanel review={mtoResult} /></CheckSection>
              )}
              {selected.includes('syllabus') && syllabusResult && (
                <CheckSection title={CHECK_LABEL.syllabus}><SyllabusReviewReport result={syllabusResult} /></CheckSection>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OverlapCheckTab({
  programId, program, loadingProgram,
}: { programId: string; program: ProgramWithDisciplines; loadingProgram: boolean }) {
  const addToast = useUIStore((s) => s.addToast)

  const [selectedIds, setSelectedIds] = useSessionStorageState<string[]>('methodist:overlap:selected', [])
  const [result, setResult] = useSessionStorageState<CurriculumAnalysis | null>('methodist:overlap:result', null)
  const [runError, setRunError] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<MobileView>('form')

  const withRpd = disciplinesWithRpd(program)
  const selectedWithoutRpd = selectedIds.filter((id) => !withRpd.has(id))
  const selectedWithRpdCount = selectedIds.length - selectedWithoutRpd.length

  const analyzeMut = useMutation({
    mutationFn: () => analyzeProgramOverlap(programId, selectedIds),
    onSuccess: (data) => { setResult(data); setRunError(null) },
    // Don't rely on the global toast alone (easy to miss, and gone after a
    // few seconds) — this is the one screen where "nothing visibly happened"
    // was the actual complaint, so the failure gets a banner that stays on
    // screen until the next attempt.
    onError: (err) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setRunError(message ?? 'Не удалось выполнить анализ — попробуйте ещё раз.')
    },
  })

  function toggle(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function run() {
    if (!programId) { addToast('Выберите программу', 'error'); return }
    if (selectedIds.length < 2) { addToast('Выберите минимум две дисциплины', 'error'); return }
    if (selectedWithRpdCount < 2) {
      setRunError('Недостаточно выбранных дисциплин с загруженной рабочей программой — нужно минимум две.')
      setMobileView('result')
      return
    }
    setResult(null)
    setRunError(null)
    setMobileView('result')
    analyzeMut.mutate()
  }

  const hasOutput = !!result || !!runError

  return (
    <div className="h-full flex flex-col">
      <MobileSubtabs view={mobileView} onChange={setMobileView} />

      <div className="flex-1 flex overflow-hidden">
        {/* Controls panel */}
        <div className={`
          md:w-[340px] md:flex-shrink-0 md:border-r md:border-border md:flex bg-surface-warm overflow-y-auto flex-col
          ${mobileView === 'form' ? 'flex w-full' : 'hidden'} md:flex
        `}>
          <div className="p-4 space-y-4">
            <FeatureIntro
              id="methodist-cabinet-overlap"
              title="Как это работает"
              description="Выберите дисциплины одной программы — система выделит изучаемые темы каждой дисциплины и покажет, где содержание дублируется для одного студента."
              steps={[
                'Отметьте 2 и более дисциплины (нужна загруженная рабочая программа у каждой)',
                'Система выделяет темы и сравнивает их семантически между дисциплинами',
                'Вы видите пары пересекающихся тем с типом пересечения и рекомендацией',
              ]}
            />

            {!programId ? (
              <p className="text-sm font-sans text-ink-secondary">Сначала выберите программу вверху страницы.</p>
            ) : loadingProgram ? (
              <div className="text-xs font-sans text-ink-tertiary py-1">Загрузка дисциплин…</div>
            ) : !program || program.disciplines.length === 0 ? (
              <p className="text-sm font-sans text-ink-secondary">В программе нет дисциплин.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary">
                    Дисциплины
                  </span>
                  <span className="text-xs font-sans text-ink-tertiary">Выбрано: {selectedIds.length}</span>
                </div>
                <div className="border border-border rounded-md overflow-hidden bg-surface">
                  <div className="max-h-[45vh] md:max-h-none overflow-y-auto">
                    {program.disciplines.map((d) => {
                      const checked = !!d.id && selectedIds.includes(d.id)
                      const hasRpd = !!d.id && withRpd.has(d.id)
                      return (
                        <label
                          key={d.id}
                          className={`flex items-center gap-2.5 px-2.5 py-2 cursor-pointer transition-colors border-b border-border last:border-b-0 ${
                            checked ? 'bg-amber-light/50' : 'hover:bg-surface-warm'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => d.id && toggle(d.id)}
                            className="accent-amber w-4 h-4 flex-shrink-0"
                          />
                          <span className="flex-1 text-sm font-sans text-ink leading-snug">{d.name}</span>
                          <RpdBadge hasRpd={hasRpd} />
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={run} loading={analyzeMut.isPending} disabled={!programId || selectedIds.length < 2}
                    className="w-full justify-center"
                  >
                    Найти дублирование
                  </Button>
                  <p className="text-xs font-sans text-ink-tertiary text-center">
                    {selectedWithoutRpd.length > 0
                      ? `Без РПД: ${selectedWithoutRpd.length} — не будут проанализированы`
                      : 'Анализ может занять 1–2 минуты'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Results panel */}
        <div className={`
          flex-1 bg-surface overflow-y-auto flex-col
          ${mobileView === 'result' ? 'flex' : 'hidden'} md:flex
        `}>
          {analyzeMut.isPending ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
              <LoadingSpinner size={20} />
              <p className="text-sm font-sans text-ink-secondary mt-3">Выделяем темы и сравниваем дисциплины…</p>
            </div>
          ) : !hasOutput ? (
            <EmptyState icon="layers" text="Выберите минимум две дисциплины и запустите анализ — пересечения появятся здесь." />
          ) : (
            <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto w-full">
              {runError && (
                <div className="bg-danger-bg border border-danger/15 rounded-lg p-3 text-xs font-sans text-danger">
                  {runError}
                </div>
              )}
              {result && <OverlapReport result={result} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
