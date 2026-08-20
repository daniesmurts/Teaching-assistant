import { useState, type ReactNode } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SyllabusReviewReport from '../../components/curriculum/SyllabusReviewReport'
import OverlapReport from '../../components/curriculum/OverlapReport'
import { PlacementReviewPanel, MtoReviewPanel, CoverageItemRow, CoverageChip, countByStatus } from '../../components/curriculum/CheckPanels'
import { listPrograms, getProgram, reviewDiscipline, reviewDisciplinePlacement, reviewDisciplineMto } from '../../api/programs'
import { reviewProgramDisciplineSyllabus, analyzeProgramOverlap } from '../../api/curriculum'
import { useUIStore } from '../../store/uiStore'
import { useSessionStorageState } from '../../hooks/useSessionStorageState'
import type {
  SyllabusReview, CurriculumAnalysis, ProgramDocumentReview, ProgramPlacementReview, ProgramMtoReview,
} from '../../types'

// Кабинет методиста (TODO.md Feature AM, Phase 1) — one place to run the
// РПД/ОП checks a методист/УМУ role needs, without borrowing a teacher's
// personal course. Every target is a programme + discipline this role
// already has read access to (via GET /api/institution/programs — the same
// scope /programs already resolves); the checks themselves are the exact
// same services the teacher-facing pages and the programme detail page run
// (services/methodist/target.ts for syllabus-review/overlap; the
// programme-scoped /review, /placement-review, /mto-review routes were
// already discipline-anchored, not course-anchored, so they needed no
// de-anchoring — just a shared home).

type Tab = 'discipline' | 'overlap'

type CheckKey = 'syllabus' | 'coverage' | 'placement' | 'mto'
const CHECK_LABEL: Record<CheckKey, string> = {
  syllabus:  'Покрытие содержания по разделам (§5–§8)',
  coverage:  'Соответствие компетенциям',
  placement: 'Место дисциплины в структуре ОП (§2)',
  mto:       'Материально-техническое обеспечение (§12)',
}
const ALL_CHECKS: CheckKey[] = ['syllabus', 'coverage', 'placement', 'mto']

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
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Кабинет методиста</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Проверка РПД и образовательных программ — без создания личного предмета.
          </p>
        </div>

        <div className="flex gap-1 border-b border-border">
          <TabButton active={tab === 'discipline'} onClick={() => setTab('discipline')}>Проверка дисциплины</TabButton>
          <TabButton active={tab === 'overlap'} onClick={() => setTab('overlap')}>Пересечение содержания</TabButton>
        </div>

        {/* Programme picker — shared by both tabs */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-sans font-medium text-ink">Образовательная программа</span>
          </div>
          {programs.length === 0 ? (
            <div className="p-4 text-sm font-sans text-ink-secondary">Нет доступных образовательных программ.</div>
          ) : (
            <div className="p-4">
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink focus:outline-none focus:border-border-strong"
              >
                <option value="">— выберите программу —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={tab === 'discipline' ? '' : 'hidden'}>
          <DisciplineChecksTab programId={programId} program={program} loadingProgram={loadingProgram} />
        </div>
        <div className={tab === 'overlap' ? '' : 'hidden'}>
          <OverlapCheckTab programId={programId} program={program} loadingProgram={loadingProgram} />
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 -mb-px text-sm font-sans font-medium border-b-2 transition-colors ${
        active ? 'border-amber text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

type ProgramWithDisciplines = { disciplines: { id?: string; name: string }[] } | undefined

function DisciplinePicker({
  program, loadingProgram, disciplineId, onChange,
}: {
  program: ProgramWithDisciplines; loadingProgram: boolean; disciplineId: string; onChange: (id: string) => void
}) {
  if (loadingProgram) return <div className="text-xs font-sans text-ink-tertiary py-1">Загрузка дисциплин…</div>
  return (
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
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
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
  const [selected, setSelected] = useSessionStorageState<CheckKey[]>('methodist:checks:selected', ALL_CHECKS)

  const [syllabusResult, setSyllabusResult]   = useSessionStorageState<SyllabusReview | null>('methodist:result:syllabus', null)
  const [coverageResult, setCoverageResult]   = useSessionStorageState<ProgramDocumentReview | null>('methodist:result:coverage', null)
  const [placementResult, setPlacementResult] = useSessionStorageState<ProgramPlacementReview | null>('methodist:result:placement', null)
  const [mtoResult, setMtoResult]             = useSessionStorageState<ProgramMtoReview | null>('methodist:result:mto', null)

  const syllabusMut = useMutation({
    mutationFn: () => reviewProgramDisciplineSyllabus(programId, disciplineId),
    onSuccess: setSyllabusResult,
  })
  const coverageMut = useMutation({
    mutationFn: () => reviewDiscipline(programId, disciplineId),
    onSuccess: setCoverageResult,
  })
  const placementMut = useMutation({
    mutationFn: () => reviewDisciplinePlacement(programId, disciplineId),
    onSuccess: setPlacementResult,
  })
  const mtoMut = useMutation({
    mutationFn: () => reviewDisciplineMto(programId, disciplineId),
    onSuccess: setMtoResult,
  })

  const mutByCheck: Record<CheckKey, { isPending: boolean }> = {
    syllabus: syllabusMut, coverage: coverageMut, placement: placementMut, mto: mtoMut,
  }
  const anyPending = selected.some((k) => mutByCheck[k].isPending)

  function toggle(key: CheckKey) {
    setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  function run() {
    if (!programId || !disciplineId) { addToast('Выберите программу и дисциплину', 'error'); return }
    if (selected.length === 0) { addToast('Выберите хотя бы одну проверку', 'error'); return }
    if (selected.includes('syllabus'))  { setSyllabusResult(null);  syllabusMut.mutate() }
    if (selected.includes('coverage'))  { setCoverageResult(null);  coverageMut.mutate() }
    if (selected.includes('placement')) { setPlacementResult(null); placementMut.mutate() }
    if (selected.includes('mto'))       { setMtoResult(null);       mtoMut.mutate() }
  }

  return (
    <div className="space-y-6">
      <FeatureIntro
        id="methodist-cabinet-discipline"
        title="Как это работает"
        description="Выберите дисциплину и отметьте нужные проверки — каждая работает с уже загруженной рабочей программой дисциплины, без создания личного предмета."
        steps={[
          'Выберите программу, дисциплину и проверки (нужна загруженная рабочая программа)',
          'Каждая проверка запускается независимо и показывает свой результат',
          'Все находки — с цитатой источника и рекомендацией',
        ]}
      />

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-sans font-medium text-ink">Дисциплина и проверки</span>
        </div>
        <div className="p-4 space-y-3">
          {programId && (
            <DisciplinePicker
              program={program} loadingProgram={loadingProgram} disciplineId={disciplineId}
              onChange={(id) => { setDisciplineId(id) }}
            />
          )}
          <div className="space-y-1.5 pt-1">
            {ALL_CHECKS.map((key) => (
              <label key={key} className="flex items-center gap-2.5 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={() => toggle(key)}
                  className="accent-amber w-4 h-4"
                />
                <span className="text-sm font-sans text-ink">{CHECK_LABEL[key]}</span>
                {mutByCheck[key].isPending && <LoadingSpinner size={12} />}
              </label>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-3">
          <Button onClick={run} loading={anyPending} disabled={!programId || !disciplineId || selected.length === 0}>
            Запустить проверки
          </Button>
          <span className="text-xs font-sans text-ink-tertiary">Каждая проверка может занять до минуты</span>
        </div>
      </div>

      {selected.includes('coverage') && coverageResult && !coverageMut.isPending && (
        <CheckSection title={CHECK_LABEL.coverage}><CoverageResultPanel review={coverageResult} /></CheckSection>
      )}
      {selected.includes('placement') && placementResult && !placementMut.isPending && (
        <CheckSection title={CHECK_LABEL.placement}><PlacementReviewPanel review={placementResult} /></CheckSection>
      )}
      {selected.includes('mto') && mtoResult && !mtoMut.isPending && (
        <CheckSection title={CHECK_LABEL.mto}><MtoReviewPanel review={mtoResult} /></CheckSection>
      )}
      {selected.includes('syllabus') && syllabusResult && !syllabusMut.isPending && (
        <CheckSection title={CHECK_LABEL.syllabus}><SyllabusReviewReport result={syllabusResult} /></CheckSection>
      )}
    </div>
  )
}

function OverlapCheckTab({
  programId, program, loadingProgram,
}: { programId: string; program: ProgramWithDisciplines; loadingProgram: boolean }) {
  const addToast = useUIStore((s) => s.addToast)

  const [selectedIds, setSelectedIds] = useSessionStorageState<string[]>('methodist:overlap:selected', [])
  const [result, setResult] = useSessionStorageState<CurriculumAnalysis | null>('methodist:overlap:result', null)

  const analyzeMut = useMutation({
    mutationFn: () => analyzeProgramOverlap(programId, selectedIds),
    onSuccess: setResult,
  })

  function toggle(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function run() {
    if (!programId) { addToast('Выберите программу', 'error'); return }
    if (selectedIds.length < 2) { addToast('Выберите минимум две дисциплины', 'error'); return }
    setResult(null)
    analyzeMut.mutate()
  }

  return (
    <div className="space-y-6">
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

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-sans font-medium text-ink">Дисциплины программы</span>
          <span className="text-xs font-sans text-ink-tertiary">Выбрано: {selectedIds.length}</span>
        </div>

        {!programId ? (
          <div className="p-4 text-sm font-sans text-ink-secondary">Сначала выберите программу.</div>
        ) : loadingProgram ? (
          <div className="p-4 text-xs font-sans text-ink-tertiary">Загрузка дисциплин…</div>
        ) : !program || program.disciplines.length === 0 ? (
          <div className="p-4 text-sm font-sans text-ink-secondary">В программе нет дисциплин.</div>
        ) : (
          <div className="p-2">
            {program.disciplines.map((d) => {
              const checked = !!d.id && selectedIds.includes(d.id)
              return (
                <label
                  key={d.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                    checked ? 'bg-amber-light/50' : 'hover:bg-surface-warm'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => d.id && toggle(d.id)}
                    className="accent-amber w-4 h-4"
                  />
                  <span className="flex-1 text-sm font-sans text-ink">{d.name}</span>
                </label>
              )
            })}
          </div>
        )}

        <div className="px-4 py-3 border-t border-border flex items-center gap-3">
          <Button onClick={run} loading={analyzeMut.isPending} disabled={!programId || selectedIds.length < 2}>
            Найти дублирование
          </Button>
          <span className="text-xs font-sans text-ink-tertiary">Анализ может занять 1–2 минуты</span>
        </div>
      </div>

      {analyzeMut.isPending && (
        <div className="text-center py-12 text-sm font-sans text-ink-secondary">
          Выделяем темы и сравниваем дисциплины…
        </div>
      )}

      {result && !analyzeMut.isPending && <OverlapReport result={result} />}
    </div>
  )
}
