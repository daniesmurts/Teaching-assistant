import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import {
  getProgram, getAnalysis, saveDisciplines, saveCompetencies, analyzeProgram, deleteProgram,
  downloadAnalysisPdf, updateProgram, uploadProgramDocument, deleteProgramDocument,
  downloadProgramDocument, reviewDiscipline, getDisciplineReviews,
} from '../../api/programs'
import { getCourses } from '../../api/courses'
import { getPickableProgramUnits } from '../../api/programs'
import {
  PROGRAM_PRACTICE_LABEL, PROGRAM_PRACTICE_TYPES,
  type ProgramDocument, type ProgramPracticeType, type ProgramDocumentReview,
  type DisciplineCoverageItem, type IndicatorDimension, type SequencingStructure,
  type OutcomeDelivery,
} from '../../types'
import { useAuthStore } from '../../store/authStore'
import { EXAMPLE_PROGRAM } from '../../lib/programExample'
import { useUIStore } from '../../store/uiStore'
import type {
  ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  CompetencyProgressionRow, CoverageLevel, PrerequisiteEdge,
} from '../../types'

type EditDiscipline = ProgramDiscipline & { _k: string }
type EditCompetency = ProgramCompetency & { _k: string }

let KEY = 0
const nextKey = () => `k${KEY++}`
const withKeyD = (d: ProgramDiscipline): EditDiscipline => ({ ...d, _k: nextKey() })
const withKeyC = (c: ProgramCompetency): EditCompetency => ({ ...c, _k: nextKey() })
const stripD = ({ _k, ...d }: EditDiscipline): ProgramDiscipline => d
const stripC = ({ _k, ...c }: EditCompetency): ProgramCompetency => c

type Tab = 'builder' | 'report' | 'documents'

export default function InstitutionProgramDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const [tab, setTab] = useState<Tab>('builder')
  const [disciplines, setDisciplines] = useState<EditDiscipline[]>([])
  const [competencies, setCompetencies] = useState<EditCompetency[]>([])
  const [dirty, setDirty] = useState(false)
  const [analysis, setAnalysis] = useState<ProgramAnalysis | null>(null)

  const { data: program } = useQuery({ queryKey: ['program', id], queryFn: () => getProgram(id) })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: cachedAnalysis } = useQuery({ queryKey: ['program-analysis', id], queryFn: () => getAnalysis(id) })
  const { data: disciplineReviews = [] } = useQuery({
    queryKey: ['program-discipline-reviews', id],
    queryFn:  () => getDisciplineReviews(id),
    enabled:  !!id,
  })

  // Read-only mode when the server says this caller can't edit this program.
  // Oversight roles (все-ro) and РОПs looking at someone else's programme
  // fall into this bucket. Legacy default: assume editable for old sessions
  // where the field is missing.
  const canEdit = program?.can_edit ?? true

  // Only IT admin (all-rw) can link a program to its `program` org_unit — an
  // РОП must not silently reassign their programme to a different tree slot.
  const canLinkOrgUnit = useAuthStore((s) => s.teacher?.program_access) === 'all-rw'
  const { data: programUnitOptions = [] } = useQuery({
    queryKey: ['program-pickable-units'],
    queryFn:  getPickableProgramUnits,
    enabled:  canLinkOrgUnit,
  })
  const linkMut = useMutation({
    mutationFn: (org_unit_id: string | null) => updateProgram(id, { org_unit_id }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['program', id] })
      qc.invalidateQueries({ queryKey: ['programs'] })
      addToast('Связь с подразделением обновлена', 'success')
    },
  })

  // Seed local state once the program loads.
  useEffect(() => {
    if (program) {
      setDisciplines(program.disciplines.map(withKeyD))
      setCompetencies(program.competencies.map(withKeyC))
      setDirty(false)
    }
  }, [program])

  useEffect(() => { if (cachedAnalysis) setAnalysis(cachedAnalysis) }, [cachedAnalysis])

  // Is the cached analysis stale relative to the programme's data? «Анализировать»
  // saves a point-in-time snapshot (sequencing, clusters, content_confidence,
  // etc.) — uploading a discipline's РПД or running a coverage check afterwards
  // does NOT recompute it. That's by design (analysis is an expensive, explicit
  // action), but it's confusing without a signal: a user uploads a РПД, sees the
  // live per-discipline coverage table update immediately, then wonders why
  // «Тематические кластеры» / content_confidence still says "0 РПД загружено".
  // Compare the analysis timestamp against the latest of: plan/competency edits
  // (program.updated_at), any document upload, any coverage-check run.
  const analysisIsStale = useMemo(() => {
    if (!analysis || !program) return false
    const generatedAt = new Date(analysis.generated_at).getTime()
    const timestamps = [
      new Date(program.updated_at).getTime(),
      ...(program.documents ?? []).map((d) => new Date(d.uploaded_at).getTime()),
      ...disciplineReviews.map((r) => new Date(r.created_at).getTime()),
    ]
    return timestamps.some((t) => t > generatedAt)
  }, [analysis, program, disciplineReviews])

  const duration = program?.duration_semesters ?? 8
  const maxSemester = Math.max(duration, ...disciplines.map((d) => d.semester), 1)
  const knownCodes = useMemo(
    () => competencies.filter((c) => c.kind === 'competency' && c.code).map((c) => c.code as string),
    [competencies]
  )

  const saveMut = useMutation({
    mutationFn: async () => {
      await saveCompetencies(id, competencies.map(stripC))
      await saveDisciplines(id, disciplines.map(stripD))
    },
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['program', id] })
      addToast('Учебный план сохранён', 'success')
    },
  })

  const analyzeMut = useMutation({
    mutationFn: async () => {
      // Always persist the current edits before analysing.
      await saveCompetencies(id, competencies.map(stripC))
      await saveDisciplines(id, disciplines.map(stripD))
      setDirty(false)
      return analyzeProgram(id)
    },
    onSuccess: (result) => {
      setAnalysis(result)
      qc.invalidateQueries({ queryKey: ['program-analysis', id] })
      // Analyse persists disciplines/competencies (saveDisciplines/saveCompetencies
      // above) before running — refetch 'program' so the Documents tab's discipline
      // list (and any auto-populated competency_codes) reflects the saved state
      // without requiring a manual page reload.
      qc.invalidateQueries({ queryKey: ['program', id] })
      setTab('report')
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteProgram(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); navigate('/programs') },
  })

  // ── Mutators ──
  function mutateD(fn: (prev: EditDiscipline[]) => EditDiscipline[]) { setDisciplines(fn); setDirty(true) }
  function mutateC(fn: (prev: EditCompetency[]) => EditCompetency[]) { setCompetencies(fn); setDirty(true) }

  function addDiscipline(semester: number) {
    mutateD((prev) => [...prev, withKeyD({
      course_id: null, name: '', semester, credits: null, control_form: null, competency_codes: [],
      sort_order: prev.filter((d) => d.semester === semester).length,
    })])
  }
  function updateDiscipline(k: string, patch: Partial<ProgramDiscipline>) {
    mutateD((prev) => prev.map((d) => (d._k === k ? { ...d, ...patch } : d)))
  }
  function removeDiscipline(k: string) { mutateD((prev) => prev.filter((d) => d._k !== k)) }

  function addCompetency() {
    mutateC((prev) => [...prev, withKeyC({ kind: 'competency', code: '', title: '', sort_order: prev.length })])
  }
  function updateCompetency(k: string, patch: Partial<ProgramCompetency>) {
    mutateC((prev) => prev.map((c) => (c._k === k ? { ...c, ...patch } : c)))
  }
  function removeCompetency(k: string) { mutateC((prev) => prev.filter((c) => c._k !== k)) }

  function loadExample() {
    setDisciplines(EXAMPLE_PROGRAM.disciplines.map(withKeyD))
    setCompetencies(EXAMPLE_PROGRAM.competencies.map(withKeyC))
    setDirty(true)
    addToast('Пример загружен — сохраните и запустите анализ', 'success')
  }

  const isEmpty = disciplines.length === 0 && competencies.length === 0

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 page-enter print:max-w-none print:p-0">
        {/* Header */}
        <button onClick={() => navigate('/programs')}
                className="text-xs font-sans text-ink-secondary hover:text-amber mb-3 print:hidden">← Все программы</button>

        {/* Org-tree linker — IT admin only. Chooses which `program` org_unit */}
        {/* backs this programme; its `head` becomes the РОП. */}
        {canLinkOrgUnit && (
          <div className="mb-4 bg-surface-warm border border-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 print:hidden">
            <label className="text-xs font-sans text-ink-secondary">Подразделение в структуре:</label>
            <select
              value={program?.org_unit_id ?? ''}
              onChange={(e) => linkMut.mutate(e.target.value || null)}
              disabled={linkMut.isPending}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-border-strong min-w-[240px]"
            >
              <option value="">— не связана —</option>
              {programUnitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.type_code === 'program_direction' ? 'Направление: ' : 'ОП: '}
                  {u.name}{u.short_name ? ` (${u.short_name})` : ''}
                </option>
              ))}
            </select>
            <span className="text-[11px] font-sans text-ink-tertiary">
              РОП = руководитель этого подразделения в дереве организации.
            </span>
          </div>
        )}

        {/* Breadcrumb — non-clickable. Shows the ancestor chain of the linked */}
        {/* program unit so an РОП sees which институт their programme sits under. */}
        {program?.org_unit_ancestors && program.org_unit_ancestors.length > 0 && (
          <div className="text-xs font-sans text-ink-tertiary mb-3 print:hidden flex flex-wrap items-center gap-1">
            {program.org_unit_ancestors.map((a, i) => (
              <span key={a.id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-ink-tertiary">›</span>}
                <span>{a.short_name || a.name}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-start justify-between gap-4 mb-5 print:hidden">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl font-bold text-ink truncate">{program?.name ?? '…'}</h1>
              {!canEdit && (
                <span
                  title="Вы видите эту программу только для чтения. Редактировать может назначенный РОП или администратор организации."
                  className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary bg-surface-warm border border-border rounded-sm px-2 py-0.5 flex-shrink-0"
                >
                  Только просмотр
                </span>
              )}
            </div>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              {program?.code && <span>{program.code} · </span>}{duration} семестров · {disciplines.length} дисциплин · {competencies.length} компетенций/целей
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="secondary" size="sm" onClick={() => saveMut.mutate()}
                      loading={saveMut.isPending} disabled={!dirty}>
                {dirty ? 'Сохранить' : 'Сохранено'}
              </Button>
              <Button size="sm" onClick={() => analyzeMut.mutate()} loading={analyzeMut.isPending}
                      disabled={disciplines.length < 2}>
                Анализировать
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border print:hidden">
          <TabButton active={tab === 'builder'} onClick={() => setTab('builder')}>Конструктор</TabButton>
          <TabButton active={tab === 'report'} onClick={() => setTab('report')}>
            Анализ{analysis ? '' : ' —'}
          </TabButton>
          <TabButton active={tab === 'documents'} onClick={() => setTab('documents')}>
            Документы{(program?.documents?.length ?? 0) > 0 ? ` · ${program!.documents!.length}` : ''}
          </TabButton>
        </div>

        {tab === 'builder' && (
          // fieldset[disabled] cascades to every input, button and select
          // inside — cleaner than threading a `disabled` prop through the
          // Builder's dozens of controls. Read-only viewers still SEE the
          // programme's shape; they can't accidentally destroy anything.
          <fieldset disabled={!canEdit} className="border-0 p-0 m-0 min-w-0 disabled:opacity-95">
            <Builder
              isEmpty={isEmpty}
              duration={duration}
              maxSemester={maxSemester}
              disciplines={disciplines}
              competencies={competencies}
              courses={courses}
              knownCodes={knownCodes}
              onLoadExample={loadExample}
              addDiscipline={addDiscipline}
              updateDiscipline={updateDiscipline}
              removeDiscipline={removeDiscipline}
              addCompetency={addCompetency}
              updateCompetency={updateCompetency}
              removeCompetency={removeCompetency}
              onDelete={() => { if (confirm('Удалить эту программу?')) deleteMut.mutate() }}
              canDelete={canEdit}
            />
          </fieldset>
        )}

        {tab === 'report' && (
          analyzeMut.isPending
            ? <div className="text-center py-16 text-sm font-sans text-ink-secondary">Анализируем архитектуру плана…</div>
            : analysis
              ? (
                <>
                  {/* Данные программы менялись (новая РПД, правки плана) после
                      последнего запуска анализа — сам анализ (кластеры,
                      последовательность, компетенции) не пересчитывается
                      автоматически при загрузке документов, только по кнопке
                      «Анализировать». Без этого сигнала непонятно, почему
                      таблица покрытия РПД обновляется сразу, а показатели
                      ниже — нет. */}
                  {analysisIsStale && (
                    <div className="flex items-start gap-2 text-sm font-sans text-warning bg-warning-bg border border-warning/15 rounded-lg px-4 py-3 mb-4">
                      <span className="flex-shrink-0 mt-0.5">⚠</span>
                      <span className="text-ink-secondary">
                        <span className="text-ink font-medium">Данные программы изменились</span> после последнего анализа (сформирован {new Date(analysis.generated_at).toLocaleString('ru-RU')}) — например, загружена новая РПД или отредактирован план. Показатели ниже (последовательность, компетенции, кластеры) не обновляются автоматически. Нажмите «Анализировать», чтобы пересчитать их с учётом новых данных.
                      </span>
                    </div>
                  )}
                  <Report analysis={analysis} duration={maxSemester} program={program} reviews={disciplineReviews} />
                </>
              )
              : (
                <>
                  <div className="text-center py-16 text-sm font-sans text-ink-secondary">
                    Анализ ещё не запускался. Нажмите «Анализировать», чтобы оценить архитектуру плана.
                  </div>
                  {/* РПД↔competency coverage is driven by per-discipline checks
                      run from the Documents tab (program-discipline-reviews),
                      independent of the plan-level «Анализировать» run above —
                      so it's still worth showing here even before the plan
                      analysis has ever been run. When a plan analysis DOES
                      exist, this renders inside <Report> instead, at its usual
                      spot after «Пробелы и избыточность» (previously this
                      whole section vanished whenever `analysis` was empty —
                      that coupling was the bug, not its position). */}
                  {program && program.disciplines.length > 0 && (
                    <DisciplineCoverageSection disciplines={program.disciplines} reviews={disciplineReviews} />
                  )}
                </>
              )
        )}

        {tab === 'documents' && program && (
          <DocumentsPanel
            programId={program.id}
            documents={program.documents ?? []}
            disciplines={program.disciplines}
            reviews={disciplineReviews}
            canEdit={canEdit}
            onChanged={() => qc.invalidateQueries({ queryKey: ['program', id] })}
            onReviewed={() => qc.invalidateQueries({ queryKey: ['program-discipline-reviews', id] })}
          />
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2 -mb-px text-sm font-sans font-medium border-b-2 transition-colors ${
        active ? 'border-amber text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
      }`}>
      {children}
    </button>
  )
}

// ─── Builder ─────────────────────────────────────────────────────────────────

interface BuilderProps {
  isEmpty: boolean
  duration: number
  maxSemester: number
  disciplines: EditDiscipline[]
  competencies: EditCompetency[]
  courses: { id: string; name: string }[]
  knownCodes: string[]
  onLoadExample: () => void
  addDiscipline: (semester: number) => void
  updateDiscipline: (k: string, patch: Partial<ProgramDiscipline>) => void
  removeDiscipline: (k: string) => void
  addCompetency: () => void
  updateCompetency: (k: string, patch: Partial<ProgramCompetency>) => void
  removeCompetency: (k: string) => void
  onDelete: () => void
  canDelete: boolean
}

function Builder(p: BuilderProps) {
  const semesters = Array.from({ length: p.maxSemester }, (_, i) => i + 1)

  return (
    <div className="space-y-6">
      {p.isEmpty && (
        <div className="bg-amber-light/50 border border-amber/20 rounded-lg p-4 flex items-center justify-between gap-4">
          <p className="text-sm font-sans text-ink">
            Пустой план. Загрузите готовый пример (09.03.01) или добавьте дисциплины вручную.
          </p>
          <Button size="sm" onClick={p.onLoadExample}>Загрузить пример</Button>
        </div>
      )}

      {/* Competencies / goals */}
      <section className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-sans font-medium text-ink">Компетенции и цели программы</span>
          <button onClick={p.addCompetency} className="text-xs font-sans text-amber font-medium hover:underline">+ добавить</button>
        </div>
        <div className="p-2 space-y-1.5">
          {p.competencies.length === 0 && (
            <p className="px-2 py-3 text-xs font-sans text-ink-tertiary">Добавьте компетенции ФГОС (УК/ОПК/ПК) и цели, которые план должен формировать.</p>
          )}
          {p.competencies.map((c) => (
            <div key={c._k} className="flex items-center gap-2">
              <div className="w-32 flex-shrink-0">
                <Select
                  value={c.kind}
                  onChange={(v) => p.updateCompetency(c._k, { kind: v as 'goal' | 'competency', code: v === 'goal' ? null : (c.code ?? '') })}
                  options={[{ value: 'competency', label: 'Компетенция' }, { value: 'goal', label: 'Цель' }]}
                />
              </div>
              {c.kind === 'competency' && (
                <input value={c.code ?? ''} onChange={(e) => p.updateCompetency(c._k, { code: e.target.value })}
                  placeholder="ОПК-1"
                  className="w-24 flex-shrink-0 text-sm font-mono bg-surface border border-border rounded-md px-2 py-2 focus:border-border-strong outline-none" />
              )}
              <input value={c.title} onChange={(e) => p.updateCompetency(c._k, { title: e.target.value })}
                placeholder="Формулировка компетенции или цели"
                className="flex-1 text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 focus:border-border-strong outline-none" />
              <button onClick={() => p.removeCompetency(c._k)} className="text-ink-tertiary hover:text-danger px-1.5 flex-shrink-0">×</button>
            </div>
          ))}
        </div>
      </section>

      {/* Semester grid */}
      <div>
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
          Дисциплины по семестрам
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {semesters.map((sem) => {
            const inSem = p.disciplines.filter((d) => d.semester === sem)
            return (
              <div key={sem} className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-surface-warm flex items-center justify-between">
                  <span className="text-xs font-sans font-semibold text-ink">Семестр {sem}</span>
                  <span className="text-[10px] font-sans text-ink-tertiary">{inSem.length} дисц.</span>
                </div>
                <div className="p-2 space-y-1">
                  {inSem.map((d) => (
                    <DisciplineRow key={d._k} d={d} maxSemester={p.maxSemester}
                      courses={p.courses} knownCodes={p.knownCodes}
                      onChange={(patch) => p.updateDiscipline(d._k, patch)}
                      onRemove={() => p.removeDiscipline(d._k)} />
                  ))}
                  <button onClick={() => p.addDiscipline(sem)}
                    className="w-full text-left text-xs font-sans text-amber hover:bg-amber-light/40 rounded-md px-2 py-1.5 transition-colors">
                    + дисциплина
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {p.canDelete && (
        <button onClick={p.onDelete} className="text-xs font-sans text-danger hover:underline">Удалить программу</button>
      )}
    </div>
  )
}

function DisciplineRow({ d, maxSemester, courses, knownCodes, onChange, onRemove }: {
  d: EditDiscipline
  maxSemester: number
  courses: { id: string; name: string }[]
  knownCodes: string[]
  onChange: (patch: Partial<ProgramDiscipline>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <input value={d.name} onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Название дисциплины"
          className="flex-1 text-sm font-sans bg-transparent outline-none placeholder:text-ink-tertiary" />
        <button onClick={() => setOpen((v) => !v)} className="text-ink-tertiary hover:text-ink text-xs px-1" title="Параметры">⋯</button>
        <button onClick={onRemove} className="text-ink-tertiary hover:text-danger px-1">×</button>
      </div>
      {open && (
        <div className="px-2 pb-2 pt-1 border-t border-border space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-sans text-ink-tertiary">Семестр</span>
              <Select value={String(d.semester)}
                onChange={(v) => onChange({ semester: Number(v) })}
                options={Array.from({ length: maxSemester }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` }))} />
            </label>
            <label className="block">
              <span className="text-[10px] font-sans text-ink-tertiary">Зач. единицы</span>
              <input type="number" min={0} value={d.credits ?? ''}
                onChange={(e) => onChange({ credits: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 focus:border-border-strong outline-none" />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-sans text-ink-tertiary">Форма контроля</span>
            <input value={d.control_form ?? ''}
              onChange={(e) => onChange({ control_form: e.target.value || null })}
              placeholder="экзамен / зачёт"
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 focus:border-border-strong outline-none" />
          </label>
          <label className="block">
            <span className="text-[10px] font-sans text-ink-tertiary">Коды компетенций {knownCodes.length > 0 && <span>({knownCodes.join(', ')})</span>}</span>
            <input value={d.competency_codes.join(', ')}
              onChange={(e) => onChange({ competency_codes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="ОПК-1, ПК-2"
              className="w-full text-sm font-mono bg-surface border border-border rounded-md px-2 py-1.5 focus:border-border-strong outline-none" />
          </label>
          <label className="block">
            <span className="text-[10px] font-sans text-ink-tertiary">Связать с дисциплиной (для анализа РПД)</span>
            <Select value={d.course_id ?? ''}
              onChange={(v) => onChange({ course_id: v || null })}
              placeholder="— без связи —"
              options={[{ value: '', label: '— без связи —' }, ...courses.map((co) => ({ value: co.id, label: co.name }))]} />
          </label>
        </div>
      )}
    </div>
  )
}

// ─── Report ──────────────────────────────────────────────────────────────────

const LEVEL_META: Record<CoverageLevel, { label: string; bg: string }> = {
  introduce: { label: 'Введение', bg: 'var(--color-amber-light)' },
  develop:   { label: 'Развитие',  bg: 'var(--color-amber-mid)' },
  master:    { label: 'Владение',  bg: 'var(--color-success)' },
}

const STATUS_META: Record<CompetencyProgressionRow['status'], { label: string; badge: string }> = {
  ok:        { label: 'Последовательно', badge: 'bg-success-bg text-success' },
  thin:      { label: 'Поверхностно',    badge: 'bg-warning-bg text-warning' },
  late:      { label: 'Поздно',          badge: 'bg-warning-bg text-warning' },
  uncovered: { label: 'Не покрыто',      badge: 'bg-danger-bg text-danger' },
}

function scoreColor(s: number): string {
  if (s >= 75) return 'var(--color-success)'
  if (s >= 50) return 'var(--color-amber)'
  return 'var(--color-danger)'
}

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
)

function Report({ analysis, duration, program, reviews = [] }: { analysis: ProgramAnalysis; duration: number; program?: ProgramDetail; reviews?: ProgramDocumentReview[] }) {
  const { sequencing, progression, orphans, missing, clusters, isolated, load, outcome_delivery } = analysis
  const maxCredits = Math.max(1, ...load.map((l) => l.credits ?? l.discipline_count))
  const [downloading, setDownloading] = useState(false)

  async function exportPdf() {
    if (!program) return
    setDownloading(true)
    try {
      await downloadAnalysisPdf(program.id, `Анализ ОП — ${program.code || program.name}.pdf`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div id="program-report" className="result-appear space-y-8">
      {/* Export — hand-styled rather than the shared secondary Button variant,
          which is a near-transparent ghost pill that read as barely visible
          floating alone on the cream page background. A solid surface +
          border + icon reads as an obvious, clickable action instead. */}
      <div className="flex justify-end -mb-2">
        <button
          onClick={exportPdf}
          disabled={!program || downloading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface border border-border-mid text-ink-secondary text-sm font-sans font-medium shadow-sm hover:text-ink hover:border-border-strong hover:bg-surface-warm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading
            ? <LoadingSpinner size={14} />
            : <DownloadIcon />}
          {downloading ? 'Экспортируем…' : 'Экспорт в PDF'}
        </button>
      </div>

      {/* Headline */}
      <div className="bg-surface border border-border rounded-lg p-5 flex items-center gap-6">
        <div className="text-center flex-shrink-0">
          <div className="font-display text-5xl font-bold leading-none" style={{ color: scoreColor(analysis.overall_score) }}>
            {analysis.overall_score}
          </div>
          <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-1">из 100</div>
        </div>
        <p className="text-sm font-sans text-ink leading-relaxed">{analysis.summary}</p>
      </div>

      {/* Non-fatal warnings from the analysis run — a section that failed */}
      {/* comes back empty, and without this the user would take the empty */}
      {/* state as truth. Rendered above outcome-delivery so it can't be missed. */}
      {analysis.warnings && analysis.warnings.length > 0 && (
        <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
          <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-warning mb-1.5">
            Часть анализа не завершилась
          </div>
          <ul className="space-y-1">
            {analysis.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs font-sans text-ink-secondary leading-relaxed">
                <span className="text-warning flex-shrink-0">⚠</span><span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outcome delivery — does the whole plan deliver the graduate profile? */}
      {/* Guarded for legacy analyses run before it shipped. */}
      {outcome_delivery && <OutcomeDeliveryCard d={outcome_delivery} />}

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Нарушений порядка" value={sequencing.inversions.length} danger={sequencing.inversions.length > 0} />
        <Stat label="Не покрыто компетенций" value={missing.length} danger={missing.length > 0} />
        <Stat label="Дисциплин без вклада" value={orphans.length} danger={orphans.length > 0} />
        <Stat label="Тематических кластеров" value={clusters.length} />
      </div>

      {/* Sequencing */}
      <section>
        <SectionLabel>Последовательность и предпосылки</SectionLabel>
        {sequencing.verdict && (
          <div className="bg-surface border border-border rounded-lg p-4 mb-3">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono font-medium" style={{ color: scoreColor(sequencing.flow_score) }}>
                {sequencing.flow_score}/100
              </span>
              <span className="text-xs font-sans text-ink-tertiary">логичность порядка</span>
            </div>
            <p className="text-sm font-sans text-ink leading-relaxed">{sequencing.verdict}</p>
          </div>
        )}
        {/* Holistic, whole-plan view — the year-1→final structure, derived from */}
        {/* the same edges. Guarded for legacy analyses run before it shipped. */}
        {sequencing.structure && sequencing.structure.layers.length > 0 && (
          <PathwayView structure={sequencing.structure} />
        )}
        {sequencing.inversions.length > 0 && (
          <div className="space-y-2 mb-3">
            {sequencing.inversions.map((e, i) => <EdgeCard key={i} edge={e} inverted />)}
          </div>
        )}
        {sequencing.edges.filter((e) => !e.inverted).length > 0 && (
          <details className="bg-surface border border-border rounded-lg">
            <summary className="px-4 py-2.5 text-xs font-sans text-ink-secondary cursor-pointer">
              Обоснованные связи ({sequencing.edges.filter((e) => !e.inverted).length})
            </summary>
            <div className="px-4 pb-3 space-y-2">
              {sequencing.edges.filter((e) => !e.inverted).map((e, i) => <EdgeCard key={i} edge={e} />)}
            </div>
          </details>
        )}
      </section>

      {/* Competency progression heatmap */}
      {progression.length > 0 && (
        <section>
          <SectionLabel>Формирование компетенций по семестрам</SectionLabel>
          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="flex-1 min-w-0 w-full">
              <div className="bg-surface border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs font-sans border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-ink-secondary sticky left-0 bg-surface" rowSpan={2}>Компетенция</th>
                      <th className="px-1 pt-2 pb-0.5 font-medium text-ink-tertiary text-center text-[10px] uppercase tracking-wide" colSpan={duration}>
                        Семестр
                      </th>
                      <th className="px-3 py-2 font-medium text-ink-secondary text-right" rowSpan={2}>Статус</th>
                    </tr>
                    <tr>
                      {Array.from({ length: duration }, (_, i) => i + 1).map((s) => (
                        <th key={s} className="px-1 pb-2 font-medium text-ink-tertiary text-center w-7" title={`Семестр ${s}`}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {progression.map((row, ri) => (
                      <ProgressionRow key={ri} row={row} duration={duration} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-4 mt-2 px-1">
                {(['introduce', 'develop', 'master'] as CoverageLevel[]).map((lv) => (
                  <span key={lv} className="flex items-center gap-1.5 text-[10px] font-sans text-ink-tertiary">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: LEVEL_META[lv].bg }} />
                    {LEVEL_META[lv].label}
                  </span>
                ))}
              </div>
            </div>

            {/* Explanation — the dots are a maturity scale per semester, not a
                status; kept visible next to the table rather than tucked away,
                since "почему тут пробел" / "что значит цвет" are the two
                questions this table reliably raises. */}
            <aside className="w-full lg:w-72 flex-shrink-0 bg-amber-light/30 border border-amber/15 rounded-lg p-4 space-y-3">
              <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-secondary">
                Как читать таблицу
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-sans text-ink-secondary leading-relaxed">
                  Цвет точки — это <span className="text-ink font-medium">не оценка</span>, а глубина освоения компетенции в этом семестре:
                </p>
                <ul className="space-y-1">
                  {(['introduce', 'develop', 'master'] as CoverageLevel[]).map((lv) => (
                    <li key={lv} className="flex items-start gap-1.5 text-xs font-sans text-ink-secondary leading-relaxed">
                      <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 mt-0.5" style={{ background: LEVEL_META[lv].bg }} />
                      <span>
                        <span className="text-ink font-medium">{LEVEL_META[lv].label}</span>
                        {lv === 'introduce' && ' — компетенция впервые появляется, базовое знакомство.'}
                        {lv === 'develop'   && ' — углубляется, отрабатывается на практике.'}
                        {lv === 'master'    && ' — ожидается уверенное владение.'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs font-sans text-ink-secondary leading-relaxed">
                Точки в строке показывают, в каких семестрах компетенция проходит путь <span className="text-ink font-medium">введение → развитие → владение</span>. Бледная точка рано, янтарная позже, зелёная ещё позже — значит план выстраивает компетенцию постепенно, а не даёт всё в одной дисциплине. Это и есть статус «{STATUS_META.ok.label}».
              </p>

              <p className="text-xs font-sans text-ink-secondary leading-relaxed">
                Пропуски между точками — это нормально: значит, в промежуточных семестрах ни одна дисциплина эту компетенцию не затрагивает. «{STATUS_META.ok.label}» означает, что верна сама <span className="text-ink font-medium">последовательность уровней</span>, а не то, что точка должна стоять в каждом семестре.
              </p>
            </aside>
          </div>
        </section>
      )}

      {/* Gaps & redundancy */}
      {(orphans.length > 0 || missing.length > 0) && (
        <section>
          <SectionLabel>Пробелы и избыточность</SectionLabel>
          {/* When few disciplines declare their competencies, «не покрыто» is */}
          {/* inferred from names and may be a mapping gap, not a real absence. */}
          {analysis.mapping_confidence?.low && missing.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs font-sans text-warning bg-warning-bg border border-warning/15 rounded-md px-3 py-2 mb-3 leading-relaxed">
              <span className="flex-shrink-0 mt-px">⚠</span>
              <span>
                Заявленные компетенции указаны лишь у {analysis.mapping_confidence.disciplines_with_codes} из {analysis.mapping_confidence.disciplines_total} дисциплин.
                Часть пунктов «не покрыто» может быть следствием отсутствия сопоставления, а не реальным пробелом — дисциплина может существовать, но её название не совпадает с формулировкой компетенции.
                Укажите компетенции дисциплин в Конструкторе или загрузите их РПД, затем перезапустите анализ.
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GapColumn title="Нет вклада в компетенции (кандидаты на исключение)" items={orphans} tone="warning" />
            <GapColumn title="Компетенции без дисциплины (нужно добавить)" items={missing} tone="danger" />
          </div>
        </section>
      )}

      {/* Discipline РПД coverage — per-discipline checks (Documents tab),
          independent of this plan-level analysis; shown here so it sits with
          the rest of the report once one exists. */}
      {program && program.disciplines.length > 0 && (
        <DisciplineCoverageSection disciplines={program.disciplines} reviews={reviews} />
      )}

      {/* Relatedness & load */}
      <section>
        <SectionLabel>Связность и нагрузка</SectionLabel>
        {/* items-start — without it CSS Grid's default row-stretch forces the
            (often much shorter) clusters card to match the height of the load
            card, leaving a large blank area under a short "не выявлено" text. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-sans font-medium text-ink mb-3">Тематические кластеры</div>
            {clusters.length === 0
              ? <p className="text-xs font-sans text-ink-tertiary">Явных кластеров не выявлено.</p>
              : <div className="space-y-2">
                  {clusters.map((cl, i) => (
                    <div key={i} className="text-xs font-sans">
                      <div className="text-ink-secondary leading-relaxed">{cl.disciplines.join(' · ')}</div>
                    </div>
                  ))}
                </div>}
            {isolated.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="text-[10px] font-sans font-semibold text-warning uppercase tracking-wide mb-1">Слабо связаны с планом</div>
                <div className="text-xs font-sans text-ink-secondary">{isolated.join(', ')}</div>
              </div>
            )}
            {/* Comparison rests on uploaded РПД content; a discipline with no */}
            {/* uploaded file falls back to name-only, coarser comparison. */}
            {analysis.content_confidence?.low && clusters.length === 0 && isolated.length === 0 && (
              <div className="mt-3 pt-3 border-t border-border flex items-start gap-1.5 text-[11px] font-sans text-warning leading-relaxed">
                <span className="flex-shrink-0">⚠</span>
                <span>
                  РПД загружены лишь у {analysis.content_confidence.disciplines_with_content} из {analysis.content_confidence.disciplines_total} дисциплин — сравнение пока опирается только на названия, поэтому «нет кластеров» может означать «пока мало данных», а не «нет тематической структуры». Загрузите РПД на вкладке «Документы» и перезапустите анализ.
                </span>
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-sans font-medium text-ink mb-3">Нагрузка по семестрам</div>
            <div className="space-y-1.5">
              {load.map((l) => (
                <div key={l.semester} className="flex items-center gap-2">
                  <span className="text-[10px] font-sans text-ink-tertiary w-12 flex-shrink-0">Сем. {l.semester}</span>
                  <div className="flex-1 h-3 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-amber/70 rounded-full"
                      style={{ width: `${((l.credits ?? l.discipline_count) / maxCredits) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-ink-secondary w-16 text-right flex-shrink-0">
                    {l.credits != null ? `${l.credits} з.е.` : `${l.discipline_count} дисц.`}
                  </span>
                </div>
              ))}
            </div>
            {/* Sanity check — the chart just sums extracted ЗЕТ, so flag when the */}
            {/* numbers contradict the ФГОС 60-з.е./year rule (likely a parse error). */}
            {analysis.load_check && analysis.load_check.issues.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-warning mb-1.5">
                  Проверка нагрузки
                </div>
                <ul className="space-y-1">
                  {analysis.load_check.issues.map((it, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] font-sans text-ink-secondary leading-relaxed">
                      <span className="text-warning flex-shrink-0">⚠</span><span>{it}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] font-sans text-ink-tertiary mt-1.5 leading-relaxed">
                  График суммирует ЗЕТ, распознанные из PDF. Проверьте семестры и ЗЕТ дисциплин в Конструкторе и перезапустите анализ.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Explanation — kept visible (not hidden behind a click) since
            "what is this" / "почему пусто" are the two questions this
            section reliably raises. */}
        <div className="bg-amber-light/30 border border-amber/15 rounded-lg p-4 mt-3 space-y-2.5">
          <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-secondary">
            Что означают эти карточки
          </div>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            <span className="text-ink font-medium">«Тематические кластеры»</span> — дисциплины, чьё содержание (по загруженной РПД, при её отсутствии — по названию) семантически близко друг другу, например «Физика», «Теоретическая механика» и «Электротехника». Это не про порядок изучения — только про то, о чём дисциплины содержательно перекликаются.
          </p>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            <span className="text-ink font-medium">«Слабо связаны с планом»</span> — дисциплины, у которых нет ни одной близкой по содержанию соседки; они не обязательно лишние, но стоит убедиться, что их место в программе обосновано.
          </p>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            <span className="text-ink font-medium">«Явных кластеров не выявлено»</span> — не всегда повод для беспокойства: план может просто не иметь тесно перекликающихся групп. Но если РПД загружены лишь у части дисциплин (см. предупреждение выше, если оно есть), сравнение идёт только по названиям и менее надёжно — загрузите РПД для точности.
          </p>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            <span className="text-ink font-medium">«Нагрузка по семестрам»</span> — сумма зачётных единиц (ЗЕТ) дисциплин каждого семестра, извлечённая из учебного плана. По ФГОС ожидается около 60 з.е. на учебный год (два семестра); заметные отклонения проверяются автоматически (см. «Проверка нагрузки» выше, если она сработала).
          </p>
        </div>
      </section>

      <p className="text-[10px] font-sans text-ink-tertiary text-center">
        Сформировано {new Date(analysis.generated_at).toLocaleString('ru-RU')}
      </p>
    </div>
  )
}

function ProgressionRow({ row, duration }: { row: CompetencyProgressionRow; duration: number }) {
  const bySem = new Map(row.cells.map((c) => [c.semester, c]))
  const meta = STATUS_META[row.status]
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 sticky left-0 bg-surface align-top max-w-[220px]">
        <div className="text-ink">
          {row.code && <span className="font-mono font-medium">{row.code} </span>}
          <span className="text-ink-secondary">{row.title}</span>
        </div>
        {row.note && <div className="text-[10px] text-ink-tertiary mt-1 leading-snug">{row.note}</div>}
      </td>
      {Array.from({ length: duration }, (_, i) => i + 1).map((s) => {
        const cell = bySem.get(s)
        return (
          <td key={s} className="px-1 py-2 text-center">
            {cell ? (
              <span className="inline-block w-5 h-5 rounded-sm" title={`${LEVEL_META[cell.level].label}: ${cell.via}`}
                style={{ background: LEVEL_META[cell.level].bg }} />
            ) : <span className="inline-block w-5 h-5 rounded-sm bg-border/40" />}
          </td>
        )
      })}
      <td className="px-3 py-2 text-right align-top">
        <span className={`text-[10px] font-sans font-medium px-2 py-0.5 rounded-sm ${meta.badge}`}>{meta.label}</span>
      </td>
    </tr>
  )
}

// Outcome-delivery headline — does the whole plan build up the graduate
// profile? Rolls up the per-competency progression into one verdict + a
// covered/thin/late/uncovered breakdown. Server-derived; this is presentation.
const DELIVERY_META: Record<OutcomeDelivery['verdict'], { label: string; fg: string; bg: string; border: string }> = {
  delivered: { label: 'Результаты обеспечены',        fg: 'text-success', bg: 'bg-success-bg', border: 'border-success/20' },
  partial:   { label: 'Обеспечены частично',          fg: 'text-warning', bg: 'bg-warning-bg', border: 'border-warning/20' },
  gaps:      { label: 'Есть необеспеченные результаты', fg: 'text-danger',  bg: 'bg-danger-bg',  border: 'border-danger/20' },
}

function OutcomeDeliveryCard({ d }: { d: OutcomeDelivery }) {
  const meta = DELIVERY_META[d.verdict]
  const chip = (label: string, value: number, color: string) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-sans">
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
      <span className="font-medium text-ink">{value}</span>
      <span className="text-ink-secondary">{label}</span>
    </span>
  )
  return (
    <div className={`rounded-lg border p-4 ${meta.bg} ${meta.border}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary">
          Достижение результатов программы
        </div>
        <span className={`text-[10px] font-sans font-semibold uppercase tracking-wide ${meta.fg}`}>{meta.label}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-center flex-shrink-0">
          <div className="font-display text-3xl font-bold leading-none" style={{ color: scoreColor(d.score) }}>{d.score}</div>
          <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-0.5">из 100</div>
        </div>
        <p className="text-sm font-sans text-ink leading-relaxed">{d.headline}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-border">
        {chip('полностью сформированы', d.fully, 'var(--color-success)')}
        {d.thin > 0      && chip('поверхностно', d.thin, 'var(--color-warning)')}
        {d.late > 0      && chip('поздно',       d.late, 'var(--color-warning)')}
        {d.uncovered > 0 && chip('не обеспечены', d.uncovered, 'var(--color-danger)')}
        <span className="text-xs font-sans text-ink-tertiary ml-auto self-center">всего {d.total}</span>
      </div>
    </div>
  )
}

// Whole-plan structure: dependency layers (foundational → professional), the
// critical prerequisite chains, and disciplines outside the graph. Derived
// server-side from the same edges — this is just the presentation.
function PathwayView({ structure }: { structure: SequencingStructure }) {
  const { layers, longest_chains, isolated } = structure
  const maxDepth = layers.length ? layers[layers.length - 1].depth : 0

  const layerLabel = (depth: number): string =>
    depth === 0 ? 'Фундамент · без предпосылок'
    : depth === maxDepth ? 'Профильные · вершина'
    : `Уровень ${depth + 1}`

  return (
    <div className="bg-surface border border-border rounded-lg p-4 mb-3 space-y-4">
      <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary">
        Дерево зависимостей — от фундаментальных к профильным
      </div>

      {/* Layers: foundational at the top, each subsequent layer builds on it. */}
      <div className="space-y-2.5">
        {layers.map((layer) => (
          <div key={layer.depth} className="flex items-start gap-3">
            <div className="w-28 flex-shrink-0 pt-1.5">
              <div className="text-[11px] font-sans font-medium text-ink-secondary leading-tight">{layerLabel(layer.depth)}</div>
            </div>
            <div className="flex-1 flex flex-wrap gap-1.5">
              {layer.disciplines.map((d, i) => (
                <span key={i}
                  className={`inline-flex items-center gap-1.5 text-xs font-sans rounded-md px-2 py-1 border ${
                    layer.depth === 0 ? 'bg-amber-light text-amber border-amber/20' : 'bg-surface-warm text-ink border-border'
                  }`}>
                  <span>{d.name}</span>
                  <span className="text-ink-tertiary">сем. {d.semester}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Critical chains — the spines where a misplacement cascades. */}
      {longest_chains.length > 0 && (
        <div className="pt-3 border-t border-border">
          <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary mb-2">
            Ключевые цепочки предпосылок
          </div>
          <div className="space-y-1.5">
            {longest_chains.map((chain, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1 text-xs font-sans">
                {chain.names.map((n, j) => (
                  <span key={j} className="inline-flex items-center gap-1">
                    <span className="text-ink">{n}</span>
                    {j < chain.names.length - 1 && <span className="text-ink-tertiary">→</span>}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Isolated — outside the dependency graph (often general-ed). */}
      {isolated.length > 0 && (
        <details className="pt-3 border-t border-border">
          <summary className="text-[11px] font-sans text-ink-secondary cursor-pointer">
            Вне графа зависимостей ({isolated.length}) — обычно общеобразовательные
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {isolated.map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs font-sans bg-surface-warm text-ink-secondary rounded-md px-2 py-1 border border-border">
                <span>{d.name}</span>
                <span className="text-ink-tertiary">сем. {d.semester}</span>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function EdgeCard({ edge, inverted = false }: { edge: PrerequisiteEdge; inverted?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${inverted ? 'bg-danger-bg border-danger/15' : 'bg-surface border-border'}`}>
      <div className="flex items-center gap-2 text-sm font-sans mb-1">
        <span className="text-ink">{edge.from_name}</span>
        <span className="text-ink-tertiary text-xs">сем. {edge.from_semester}</span>
        <span className="text-ink-tertiary">→</span>
        <span className="text-ink">{edge.to_name}</span>
        <span className="text-ink-tertiary text-xs">сем. {edge.to_semester}</span>
        {inverted && <span className="ml-auto text-[10px] font-medium text-danger uppercase tracking-wide">нарушение порядка</span>}
      </div>
      {edge.reason && <p className="text-xs font-sans text-ink-secondary leading-relaxed">{edge.reason}</p>}
      {inverted && edge.recommendation && (
        <p className="text-xs font-sans text-ink mt-1.5 leading-relaxed">
          <span className="font-medium text-amber">Рекомендация: </span>{edge.recommendation}
        </p>
      )}
    </div>
  )
}

function GapColumn({ title, items, tone }: {
  title: string; items: { name: string; reason: string; recommendation: string }[]; tone: 'warning' | 'danger'
}) {
  const bg = tone === 'danger' ? 'bg-danger-bg border-danger/15' : 'bg-warning-bg border-warning/15'
  const fg = tone === 'danger' ? 'text-danger' : 'text-warning'
  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className={`text-[10px] font-sans font-semibold uppercase tracking-wide mb-2 ${fg}`}>{title}</div>
      {items.length === 0
        ? <p className="text-xs font-sans text-ink-tertiary">Нет</p>
        : <div className="space-y-2.5">
            {items.map((it, i) => (
              <div key={i}>
                <div className="text-sm font-sans text-ink">{it.name}</div>
                {it.recommendation && <div className="text-xs font-sans text-ink-secondary leading-relaxed mt-0.5">{it.recommendation}</div>}
              </div>
            ))}
          </div>}
    </div>
  )
}

// Migration 051 — per-discipline РПД conformance table: does the uploaded
// document actually cover the competencies the discipline claims to develop.
// Fills in incrementally as more disciplines get their РПД uploaded and
// checked from the Documents tab — no requirement that every discipline be
// covered before this renders anything useful.
const COVERAGE_STATUS_META: Record<'covered' | 'partial' | 'missing', { label: string; color: string }> = {
  covered: { label: 'раскрыта',   color: 'var(--color-success)' },
  partial: { label: 'частично',   color: 'var(--color-warning)' },
  missing: { label: 'не раскрыта', color: 'var(--color-danger)' },
}

function DisciplineCoverageSection({
  disciplines, reviews,
}: {
  disciplines: ProgramDiscipline[]
  reviews:     ProgramDocumentReview[]
}) {
  const reviewByDiscipline = new Map(reviews.map((r) => [r.discipline_id, r]))
  const sorted = [...disciplines].sort((a, b) => a.semester - b.semester || a.sort_order - b.sort_order)
  if (reviews.length === 0) return null   // nothing checked yet — no point rendering an all-empty table

  const checkedCount = reviews.length
  const totalCount = disciplines.length

  return (
    <section>
      <SectionLabel>Соответствие РПД компетенциям</SectionLabel>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full bg-surface border border-border rounded-lg divide-y divide-border">
          {sorted.map((d) => {
            const review = d.id ? reviewByDiscipline.get(d.id) : null
            return (
              <details key={d.id ?? d.name} className="group">
                <summary className="px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer list-none">
                  <span className="text-sm font-sans text-ink truncate">{d.name}</span>
                  {review ? (
                    <span
                      className="text-xs font-mono font-medium flex-shrink-0"
                      style={{ color: scoreColor(review.result.overall_coverage) }}
                    >
                      {review.result.overall_coverage}%
                    </span>
                  ) : (
                    <span className="text-xs font-sans text-ink-tertiary flex-shrink-0">не проверено</span>
                  )}
                </summary>
                {review && (
                  <div className="px-4 pb-3 space-y-2">
                    {review.result.summary && (
                      <p className="text-xs font-sans text-ink-secondary leading-relaxed">{review.result.summary}</p>
                    )}
                    {review.result.items.map((it, i) => <CoverageItemRow key={i} it={it} />)}
                  </div>
                )}
              </details>
            )
          })}
        </div>

        {/* Explanation — this table is per-discipline (independent of the
            whole-plan «Анализировать» run above/below it), so it's easy to
            mistake an empty "не проверено" row for a bug. Kept visible next
            to the table since "what does % mean" / "why isn't my discipline
            checked" are the two questions this list reliably raises. */}
        <aside className="w-full lg:w-72 flex-shrink-0 bg-amber-light/30 border border-amber/15 rounded-lg p-4 space-y-3">
          <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-secondary">
            Что это и как этим пользоваться
          </div>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            Здесь — результат проверки, действительно ли <span className="text-ink font-medium">содержание загруженной РПД</span> раскрывает компетенции, заявленные за дисциплиной. Это отдельная, более точная проверка на уровне одной дисциплины — она не связана с общим анализом плана выше.
          </p>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            <span className="text-ink font-medium">«не проверено»</span> значит, что для этой дисциплины ещё не загружена РПД или проверка ещё не запускалась — это не ошибка. Загрузите файл и запустите проверку на вкладке <span className="text-ink font-medium">«Документы»</span> кнопкой «Проверить соответствие компетенциям».
          </p>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">
            Процент — это доля покрытия компетенций дисциплины (полностью / частично / не раскрыты, посчитано по индикаторам). <span className="text-ink font-medium">Нажмите на строку</span>, чтобы развернуть её и увидеть разбор по каждой компетенции с цитатами из текста.
          </p>
          {totalCount > 0 && (
            <p className="text-xs font-sans text-ink-tertiary leading-relaxed pt-1 border-t border-amber/15">
              Проверено {checkedCount} из {totalCount} дисциплин.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="font-display text-3xl font-bold leading-none" style={{ color: danger ? 'var(--color-danger)' : 'var(--color-ink)' }}>
        {value}
      </div>
      <div className="text-xs font-sans text-ink-secondary mt-1.5">{label}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">{children}</div>
}

// Documents tab — рабочая программа (per discipline) + практики. РПД is
// gathered incrementally, one discipline at a time, never all at once — so
// this renders every discipline in the plan as a row: upload affordance if
// none uploaded yet, otherwise the file + a "Проверить соответствие" trigger
// that checks it against the discipline's declared competency_codes.
function DocumentsPanel({
  programId, documents, disciplines, reviews, canEdit, onChanged, onReviewed,
}: {
  programId:   string
  documents:   ProgramDocument[]
  disciplines: ProgramDiscipline[]
  reviews:     ProgramDocumentReview[]
  canEdit:     boolean
  onChanged:   () => void
  onReviewed:  () => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [uploading, setUploading] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  // Which discipline rows have their inline coverage breakdown open. On a
  // freshly completed review we auto-open the row that was just checked (the
  // user just clicked «Проверить» — the answer should be visible immediately,
  // not one more click away). Toggled by the user thereafter.
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set())

  const workingProgrammeByDiscipline = new Map(
    documents.filter((d) => d.kind === 'working_programme' && d.discipline_id).map((d) => [d.discipline_id as string, d])
  )
  const reviewByDiscipline = new Map(reviews.map((r) => [r.discipline_id, r]))
  const practices = documents.filter((d) => d.kind === 'practice')

  async function attachOne(input: { file: File; kind: 'working_programme' | 'practice'; practiceType?: ProgramPracticeType | null; disciplineId?: string | null }) {
    setUploading(true)
    try {
      const res = await uploadProgramDocument(programId, input)
      if (res.detected_competency_codes.length > 0) {
        addToast(
          `Документ добавлен · автоматически определено компетенций: ${res.detected_competency_codes.length}`,
          'success',
        )
      } else {
        addToast('Документ добавлен', 'success')
      }
      // A re-upload replaces the previous file, which cascade-drops the coverage
      // review — tell the user so they don't miss that the check now shows
      // stale/empty results until re-run.
      if (res.replaced_review) {
        addToast(
          'Предыдущая проверка соответствия сброшена — запустите её повторно, чтобы обновить результат.',
          'info',
        )
      }
      onChanged()
    } catch {
      // Axios interceptor handles the error toast.
    } finally {
      setUploading(false)
    }
  }

  async function removeOne(doc: ProgramDocument) {
    if (!confirm(`Удалить «${doc.file_name}»?`)) return
    try {
      await deleteProgramDocument(programId, doc.id)
      addToast('Документ удалён', 'success')
      onChanged()
    } catch {
      // handled by interceptor
    }
  }

  async function runReview(discipline: ProgramDiscipline) {
    if (!discipline.id) return
    const disciplineId = discipline.id
    setReviewingId(disciplineId)
    try {
      const review = await reviewDiscipline(programId, disciplineId)
      const counts = countByStatus(review.result.items)
      addToast(
        `Раскрыто: ${counts.covered} · Частично: ${counts.partial} · Не раскрыто: ${counts.missing}`,
        'success',
      )
      setExpandedReviews((prev) => new Set(prev).add(disciplineId))
      onReviewed()
    } catch {
      // handled by interceptor
    } finally {
      setReviewingId(null)
    }
  }

  function toggleExpanded(disciplineId: string) {
    setExpandedReviews((prev) => {
      const next = new Set(prev)
      if (next.has(disciplineId)) next.delete(disciplineId)
      else next.add(disciplineId)
      return next
    })
  }

  return (
    <div className="space-y-8">
      {/* Working programmes — one per discipline */}
      <div>
        <SectionLabel>Рабочие программы дисциплин</SectionLabel>
        {disciplines.length === 0 ? (
          <p className="text-sm font-sans text-ink-secondary bg-surface border border-border rounded-lg px-4 py-3">
            Сначала добавьте дисциплины в конструкторе плана.
          </p>
        ) : (
          <div className="space-y-2">
            {[...disciplines].sort((a, b) => a.semester - b.semester || a.sort_order - b.sort_order).map((d) => (
              <DisciplineDocumentRow
                key={d.id}
                discipline={d}
                doc={d.id ? workingProgrammeByDiscipline.get(d.id) ?? null : null}
                review={d.id ? reviewByDiscipline.get(d.id) ?? null : null}
                expanded={d.id ? expandedReviews.has(d.id) : false}
                onToggleExpanded={() => d.id && toggleExpanded(d.id)}
                programId={programId}
                canEdit={canEdit}
                uploading={uploading}
                reviewing={reviewingId === d.id}
                onUpload={(file) => attachOne({ file, kind: 'working_programme', disciplineId: d.id })}
                onRemove={(doc) => removeOne(doc)}
                onReview={() => runReview(d)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Practices */}
      <div>
        <SectionLabel>Практики</SectionLabel>
        {practices.length === 0 ? (
          <p className="text-sm font-sans text-ink-secondary bg-surface border border-border rounded-lg px-4 py-3">
            Практики не загружены.
          </p>
        ) : (
          <div className="space-y-2">
            {practices.map((d) => (
              <DocumentRow key={d.id} doc={d} programId={programId} canEdit={canEdit} onRemove={() => removeOne(d)} />
            ))}
          </div>
        )}
        {canEdit && (
          <div className="mt-3">
            <AddPractice
              disabled={uploading}
              usedTypes={practices.map((d) => d.practice_type).filter(Boolean) as ProgramPracticeType[]}
              onSubmit={(input) => attachOne({ file: input.file, kind: 'practice', practiceType: input.type })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentRow({
  doc, programId, canEdit, onRemove,
}: {
  doc:       ProgramDocument
  programId: string
  canEdit:   boolean
  onRemove:  () => void
}) {
  const label = doc.kind === 'practice' && doc.practice_type
    ? PROGRAM_PRACTICE_LABEL[doc.practice_type]
    : 'Рабочая программа'
  const kb = Math.round(doc.file_size / 1024)

  async function download() {
    try { await downloadProgramDocument(programId, doc) }
    catch { /* handled by interceptor */ }
  }

  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-start gap-3">
      <div className="text-lg leading-none mt-0.5">📄</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-sans text-ink-tertiary uppercase tracking-wider">{label}</div>
        <div className="text-sm font-sans text-ink truncate">{doc.file_name}</div>
        <div className="text-[11px] font-sans text-ink-tertiary mt-0.5">
          {kb.toLocaleString('ru-RU')} КБ · {new Date(doc.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={download} className="text-xs font-sans text-amber hover:underline">Скачать</button>
        {canEdit && (
          <button onClick={onRemove} className="text-xs font-sans text-ink-tertiary hover:text-danger transition-colors">Удалить</button>
        )}
      </div>
    </div>
  )
}

// One discipline's РПД slot: upload affordance if empty, otherwise the file
// plus a "Проверить соответствие" trigger that scores it against the
// discipline's declared competency_codes (disabled with an explanatory
// tooltip if none are declared — nothing to check against).
function DisciplineDocumentRow({
  discipline, doc, review, expanded, onToggleExpanded,
  programId, canEdit, uploading, reviewing, onUpload, onRemove, onReview,
}: {
  discipline:        ProgramDiscipline
  doc:               ProgramDocument | null
  review:            ProgramDocumentReview | null
  expanded:          boolean
  onToggleExpanded:  () => void
  programId:         string
  canEdit:           boolean
  uploading:         boolean
  reviewing:         boolean
  onUpload:          (file: File) => void
  onRemove:          (doc: ProgramDocument) => void
  onReview:          () => void
}) {
  const hasCodes = discipline.competency_codes.length > 0
  const kb = doc ? Math.round(doc.file_size / 1024) : 0
  const counts = review ? countByStatus(review.result.items) : null

  async function download() {
    if (!doc) return
    try { await downloadProgramDocument(programId, doc) }
    catch { /* handled by interceptor */ }
  }

  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="text-lg leading-none mt-0.5">📄</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-sans text-ink truncate">
            {discipline.name} <span className="text-ink-tertiary text-xs">· сем. {discipline.semester}</span>
          </div>
          {doc ? (
            <>
              <div className="text-xs font-sans text-ink-secondary truncate mt-0.5">{doc.file_name}</div>
              <div className="text-[11px] font-sans text-ink-tertiary mt-0.5">
                {kb.toLocaleString('ru-RU')} КБ · {new Date(doc.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              {counts && (
                <div className="flex items-center gap-3 mt-1.5 text-[11px] font-sans">
                  <CoverageChip label="раскрыто"     value={counts.covered} status="covered" />
                  <CoverageChip label="частично"     value={counts.partial} status="partial" />
                  <CoverageChip label="не раскрыто"  value={counts.missing} status="missing" />
                </div>
              )}
            </>
          ) : (
            <div className="text-xs font-sans text-ink-tertiary mt-0.5">Не загружена</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {doc && (
            <button onClick={download} className="text-xs font-sans text-amber hover:underline">Скачать</button>
          )}
          {canEdit && doc && (
            <button onClick={() => onRemove(doc)} className="text-xs font-sans text-ink-tertiary hover:text-danger transition-colors">Удалить</button>
          )}
          {canEdit && (
            <UploadPill
              label={doc ? 'Заменить' : 'Загрузить'}
              onPick={onUpload}
              disabled={uploading}
            />
          )}
        </div>
      </div>
      {canEdit && doc && (
        <div className="mt-2 pl-8 flex items-center gap-3">
          <button
            onClick={onReview}
            disabled={reviewing || !hasCodes}
            title={hasCodes ? undefined : 'У дисциплины не указаны компетенции — заполните их в конструкторе плана'}
            className="text-xs font-sans text-amber hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
          >
            {reviewing ? 'Проверяем…' : review ? 'Перепроверить соответствие' : 'Проверить соответствие компетенциям'}
          </button>
          {review && (
            <button
              onClick={onToggleExpanded}
              className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors"
            >
              {expanded ? 'Скрыть разбор' : 'Показать разбор'}
            </button>
          )}
        </div>
      )}
      {review && expanded && (
        <div className="mt-3 pl-8 pr-1 space-y-2 border-t border-border pt-3">
          {review.result.summary && (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">{review.result.summary}</p>
          )}
          {review.result.items.map((it, i) => <CoverageItemRow key={i} it={it} />)}
        </div>
      )}
    </div>
  )
}

function countByStatus(items: DisciplineCoverageItem[]): { covered: number; partial: number; missing: number } {
  const counts = { covered: 0, partial: 0, missing: 0 }
  for (const it of items) counts[it.status]++
  return counts
}

const DIMENSION_LABEL: Record<IndicatorDimension, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

// One competency row in a coverage breakdown, with its индикаторы достижения
// nested beneath it (ФГОС 3++). The competency's own status is the roll-up of
// its indicators; each indicator shows its Знать/Уметь/Владеть layer, status,
// evidence quote and note. Legacy reviews (no indicators) render as before.
function CoverageItemRow({ it }: { it: DisciplineCoverageItem }) {
  const meta = COVERAGE_STATUS_META[it.status]
  return (
    <div className="text-xs font-sans border-l-2 pl-2.5" style={{ borderColor: meta.color }}>
      <div className="flex items-center gap-2">
        <span className="text-ink font-medium">{it.code ? `${it.code} — ${it.title}` : it.title}</span>
        <span style={{ color: meta.color }}>{meta.label}</span>
        {it.indicators && it.indicators.length > 0 && (
          <span className="text-ink-tertiary">· {it.indicators.length} индик.</span>
        )}
      </div>
      {it.evidence && <div className="text-ink-tertiary italic mt-0.5">«{it.evidence}»</div>}
      {it.note && <div className="text-ink-secondary mt-0.5">{it.note}</div>}
      {it.indicators && it.indicators.length > 0 && (
        <div className="mt-1.5 ml-0.5 space-y-1.5 border-l border-border pl-2.5">
          {it.indicators.map((ind, j) => {
            const im = COVERAGE_STATUS_META[ind.status]
            return (
              <div key={j}>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 translate-y-[-1px]" style={{ background: im.color }} />
                  {ind.code && <span className="font-mono text-ink-secondary">{ind.code}</span>}
                  {ind.dimension && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">{DIMENSION_LABEL[ind.dimension]}</span>
                  )}
                  <span className="text-ink">{ind.title}</span>
                  <span style={{ color: im.color }}>{im.label}</span>
                </div>
                {ind.evidence && <div className="text-ink-tertiary italic ml-3 mt-0.5">«{ind.evidence}»</div>}
                {ind.note && <div className="text-ink-secondary ml-3 mt-0.5">{ind.note}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CoverageChip({ label, value, status }: { label: string; value: number; status: 'covered' | 'partial' | 'missing' }) {
  const meta = COVERAGE_STATUS_META[status]
  if (value === 0) {
    return <span className="text-ink-tertiary">0 {label}</span>
  }
  return (
    <span className="inline-flex items-center gap-1" style={{ color: meta.color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: meta.color }} />
      <span className="font-medium">{value}</span>
      <span>{label}</span>
    </span>
  )
}

function UploadPill({
  label, onPick, disabled,
}: {
  label:    string
  onPick:   (f: File) => void
  disabled: boolean
}) {
  const ref = useMemo(() => ({ current: null as HTMLInputElement | null }), [])
  return (
    <>
      <input
        ref={(el) => { ref.current = el }}
        type="file" accept="application/pdf" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled}
        className="text-xs font-sans text-amber hover:underline disabled:opacity-60"
      >
        + {label}
      </button>
    </>
  )
}

function AddPractice({
  disabled, usedTypes, onSubmit,
}: {
  disabled:  boolean
  usedTypes: ProgramPracticeType[]
  onSubmit:  (input: { file: File; type: ProgramPracticeType }) => void
}) {
  const [type, setType] = useState<ProgramPracticeType | ''>('')
  const ref = useMemo(() => ({ current: null as HTMLInputElement | null }), [])

  function handlePick(f: File) {
    if (!type) return
    onSubmit({ file: f, type })
    setType('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as ProgramPracticeType | '')}
        className="text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-border-strong"
      >
        <option value="" disabled>+ Добавить практику — выберите тип</option>
        {PROGRAM_PRACTICE_TYPES.map((t) => (
          <option key={t} value={t} disabled={usedTypes.includes(t)}>
            {PROGRAM_PRACTICE_LABEL[t]}
          </option>
        ))}
      </select>
      <input
        ref={(el) => { ref.current = el }}
        type="file" accept="application/pdf" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handlePick(f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled || !type}
        className="text-xs font-sans text-amber hover:underline disabled:opacity-40"
      >
        Выбрать файл
      </button>
    </div>
  )
}
