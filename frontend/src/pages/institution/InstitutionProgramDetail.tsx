import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import UrlUploadField from '../../components/ui/UrlUploadField'
import SvedenImportModal from '../../components/programs/SvedenImportModal'
import EditProgramModal from '../../components/programs/EditProgramModal'
import CurriculumGraph from '../../components/programs/CurriculumGraph'
import Icon from '../../components/ui/Icon'
import {
  PlacementReviewPanel, MtoReviewPanel, CoverageItemRow, CoverageChip, countByStatus,
} from '../../components/curriculum/CheckPanels'
import {
  scoreColor, Stat, SectionLabel, OutcomeDeliveryCard, GapColumn, EdgeCard,
} from '../../components/curriculum/ProgramAnalysisSummary'
import {
  getProgram, getAnalysis, getProgramTopology, saveDisciplines, saveCompetencies, analyzeProgram, deleteProgram,
  downloadAnalysisPdf, updateProgram, uploadProgramDocument, deleteProgramDocument,
  downloadProgramDocument, reviewDiscipline, getDisciplineReviews, openDisciplineInStudio,
  diffDiscipline, getAssignableTeachers, setDisciplineResponsible, type AssignableTeacher,
  reviewDisciplinePlacement, getPlacementReviews,
  reviewDisciplineMto, getMtoReviews,
  getProfstandardOptions,
} from '../../api/programs'
import { getCourses } from '../../api/courses'
import { getPickableProgramUnits } from '../../api/programs'
import {
  PROGRAM_PRACTICE_LABEL, PROGRAM_PRACTICE_TYPES,
  type ProgramDocument, type ProgramPracticeType, type ProgramDocumentReview, type ProgramDocumentKind,
  type SequencingStructure,
  type ProgramDocumentDiff, type DiffChangeKind,
  type ProgramPlacementReview,
  type ProgramMtoReview,
} from '../../types'
import { useAuthStore } from '../../store/authStore'
import { EXAMPLE_PROGRAM } from '../../lib/programExample'
import { useUIStore } from '../../store/uiStore'
import type {
  ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramCompetencyIndicator, ProgramAnalysis,
  CompetencyProgressionRow, CoverageLevel, PrerequisiteEdge,
  ProgramTopology, ProgramPrerequisite,
  PkFormulationFinding, ProfstandardOption,
} from '../../types'

type EditDiscipline = ProgramDiscipline & { _k: string }
type EditCompetency = ProgramCompetency & { _k: string }

let KEY = 0
const nextKey = () => `k${KEY++}`
const withKeyD = (d: ProgramDiscipline): EditDiscipline => ({ ...d, _k: nextKey() })
const withKeyC = (c: ProgramCompetency): EditCompetency => ({ ...c, _k: nextKey() })
const stripD = ({ _k, ...d }: EditDiscipline): ProgramDiscipline => d
const stripC = ({ _k, ...c }: EditCompetency): ProgramCompetency => c

type Tab = 'builder' | 'report' | 'topology' | 'documents'

export default function InstitutionProgramDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const [tab, setTab] = useState<Tab>('builder')
  // Fixes a dead end: a typo'd code or misspelt specialty name at intake had
  // no way to be corrected afterwards, and silently broke sveden-page import
  // matching. See EditProgramModal.
  const [editingProgram, setEditingProgram] = useState(false)
  const [disciplines, setDisciplines] = useState<EditDiscipline[]>([])
  const [competencies, setCompetencies] = useState<EditCompetency[]>([])
  const [dirty, setDirty] = useState(false)
  const [analysis, setAnalysis] = useState<ProgramAnalysis | null>(null)
  // ПК↔ОТФ formulation warnings (migration 115, методист feedback item 3) —
  // returned inline by the last saveCompetencies call, shown under the
  // offending ПК row rather than requiring a separate check to surface them.
  const [formulationWarnings, setFormulationWarnings] = useState<PkFormulationFinding[]>([])

  const { data: program } = useQuery({ queryKey: ['program', id], queryFn: () => getProgram(id) })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: cachedAnalysis } = useQuery({ queryKey: ['program-analysis', id], queryFn: () => getAnalysis(id) })
  // Lazy — only fetched once the tab is actually opened, since it's read-only
  // and adds nothing to the builder/report tabs.
  const { data: topology } = useQuery({
    queryKey: ['program-topology', id],
    queryFn:  () => getProgramTopology(id),
    enabled:  tab === 'topology',
  })
  const { data: disciplineReviews = [] } = useQuery({
    queryKey: ['program-discipline-reviews', id],
    queryFn:  () => getDisciplineReviews(id),
    enabled:  !!id,
  })
  // «Место дисциплины в структуре ОП» (migration 100) — only needed on the
  // Documents tab where the check is triggered.
  const { data: placementReviews = [] } = useQuery({
    queryKey: ['program-placement-reviews', id],
    queryFn:  () => getPlacementReviews(id),
    enabled:  tab === 'documents',
  })
  // «Материально-техническое обеспечение» (migration 101) — same lazy-load
  // rule as placementReviews above.
  const { data: mtoReviews = [] } = useQuery({
    queryKey: ['program-mto-reviews', id],
    queryFn:  () => getMtoReviews(id),
    enabled:  tab === 'documents',
  })
  // ПК↔ОТФ picker options (migration 115) — only needed on the Конструктор
  // tab, same lazy-load rule as topology/placementReviews above.
  const { data: profstandardOptions = [] } = useQuery({
    queryKey: ['program-profstandard-options', id],
    queryFn:  () => getProfstandardOptions(id),
    enabled:  tab === 'builder',
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
      const result = await saveCompetencies(id, competencies.map(stripC))
      await saveDisciplines(id, disciplines.map(stripD))
      return result
    },
    onSuccess: (result) => {
      setDirty(false)
      setFormulationWarnings(result.formulation_warnings)
      qc.invalidateQueries({ queryKey: ['program', id] })
      addToast('Учебный план сохранён', 'success')
    },
  })

  const analyzeMut = useMutation({
    mutationFn: async () => {
      // Always persist the current edits before analysing.
      const result = await saveCompetencies(id, competencies.map(stripC))
      setFormulationWarnings(result.formulation_warnings)
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
              <Button variant="secondary" size="sm" onClick={() => setEditingProgram(true)}
                      title="Исправить код, название, профиль или уровень программы">
                Редактировать
              </Button>
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
          <TabButton active={tab === 'topology'} onClick={() => setTab('topology')}>
            Топология{analysis ? '' : ' —'}
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
              profstandardOptions={profstandardOptions}
              formulationWarnings={formulationWarnings}
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
                    <DisciplineCoverageSection
                      disciplines={program.disciplines}
                      reviews={disciplineReviews}
                      documents={program.documents ?? []}
                    />
                  )}
                </>
              )
        )}

        {tab === 'topology' && (
          analysis
            ? (
              <TopologyTab
                analysis={analysis} topology={topology} program={program}
                duration={maxSemester}
              />
            )
            : (
              <div className="text-center py-16 text-sm font-sans text-ink-secondary">
                Анализ ещё не запускался. Нажмите «Анализировать», чтобы построить граф.
              </div>
            )
        )}

        {tab === 'documents' && program && (
          <DocumentsPanel
            programId={program.id}
            documents={program.documents ?? []}
            disciplines={program.disciplines}
            reviews={disciplineReviews}
            placementReviews={placementReviews}
            mtoReviews={mtoReviews}
            canEdit={canEdit}
            onChanged={() => qc.invalidateQueries({ queryKey: ['program', id] })}
            onReviewed={() => qc.invalidateQueries({ queryKey: ['program-discipline-reviews', id] })}
            onPlacementReviewed={() => qc.invalidateQueries({ queryKey: ['program-placement-reviews', id] })}
            onMtoReviewed={() => qc.invalidateQueries({ queryKey: ['program-mto-reviews', id] })}
          />
        )}
      </div>

      {editingProgram && program && (
        <EditProgramModal program={program} onClose={() => setEditingProgram(false)} />
      )}
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
  profstandardOptions: ProfstandardOption[]
  formulationWarnings: PkFormulationFinding[]
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
            <CompetencyRow
              key={c._k}
              c={c}
              onUpdate={(patch) => p.updateCompetency(c._k, patch)}
              onRemove={() => p.removeCompetency(c._k)}
              profstandardOptions={p.profstandardOptions}
              warnings={p.formulationWarnings.filter((w) => w.competency_code === c.code)}
            />
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

// A ПК code (case-insensitive) gets the ОТФ-derivation sub-panel below;
// УК/ОПК don't — they come verbatim from the ФГОС (fgos_competency_id,
// migration 099) and being identical to federal text is correct for them,
// the opposite invariant from what this panel checks.
function isPkCode(code: string | null): boolean {
  return !!code && code.trim().toUpperCase().startsWith('ПК')
}

function CompetencyRow({ c, onUpdate, onRemove, profstandardOptions, warnings }: {
  c:                    EditCompetency
  onUpdate:             (patch: Partial<ProgramCompetency>) => void
  onRemove:             () => void
  profstandardOptions:  ProfstandardOption[]
  warnings:             PkFormulationFinding[]
}) {
  const [expanded, setExpanded] = useState(false)
  // Which профстандарт is being browsed in the picker — independent of the
  // persisted profstandard_otf_id until an ОТФ is actually chosen, so
  // switching the first dropdown can filter the second before committing to
  // anything.
  const [pickedPsId, setPickedPsId] = useState('')
  const isPk = c.kind === 'competency' && isPkCode(c.code)

  const selectedOtf = profstandardOptions
    .flatMap((ps) => ps.otf.map((o) => ({ ps, o })))
    .find(({ o }) => o.id === c.profstandard_otf_id)
  const activePsId = pickedPsId || selectedOtf?.ps.id || ''
  const otfOptions = profstandardOptions.find((ps) => ps.id === activePsId)?.otf ?? []

  function updateIndicator(i: number, patch: Partial<ProgramCompetencyIndicator>) {
    onUpdate({ indicators: (c.indicators ?? []).map((ind, idx) => idx === i ? { ...ind, ...patch } : ind) })
  }
  function removeIndicator(i: number) {
    onUpdate({ indicators: (c.indicators ?? []).filter((_, idx) => idx !== i) })
  }
  function addIndicator() {
    const n = (c.indicators ?? []).length + 1
    onUpdate({ indicators: [...(c.indicators ?? []), { code: `${c.code ?? 'ПК'}.${n}`, title: '', sort_order: n - 1 }] })
  }

  return (
    <div className="rounded-md border border-border-mid overflow-hidden">
      <div className="flex items-center gap-2 p-1.5">
        <div className="w-32 flex-shrink-0">
          <Select
            value={c.kind}
            onChange={(v) => onUpdate({ kind: v as 'goal' | 'competency', code: v === 'goal' ? null : (c.code ?? '') })}
            options={[{ value: 'competency', label: 'Компетенция' }, { value: 'goal', label: 'Цель' }]}
          />
        </div>
        {c.kind === 'competency' && (
          <input value={c.code ?? ''} onChange={(e) => onUpdate({ code: e.target.value })}
            placeholder="ОПК-1"
            className="w-24 flex-shrink-0 text-sm font-mono bg-surface border border-border rounded-md px-2 py-2 focus:border-border-strong outline-none" />
        )}
        <input value={c.title} onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Формулировка компетенции или цели"
          className="flex-1 text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 focus:border-border-strong outline-none" />
        {isPk && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title="Связать с профстандартом/ОТФ и индикаторами"
            className={`flex-shrink-0 text-xs font-sans px-2 py-1.5 rounded-md border transition-colors ${
              c.profstandard_otf_id
                ? 'border-success/40 text-success bg-success-bg'
                : warnings.length > 0
                  ? 'border-warning/40 text-warning bg-warning-bg'
                  : 'border-border-mid text-ink-secondary hover:border-amber/60 hover:text-amber'
            }`}
          >
            {c.profstandard_otf_id ? 'ОТФ связана' : 'Связать с ОТФ'}
          </button>
        )}
        <button onClick={onRemove} className="text-ink-tertiary hover:text-danger px-1.5 flex-shrink-0">×</button>
      </div>

      {isPk && expanded && (
        <div className="border-t border-border-mid bg-surface-warm p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={activePsId}
              onChange={(e) => { setPickedPsId(e.target.value); onUpdate({ profstandard_otf_id: null }) }}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong"
            >
              <option value="">— профстандарт —</option>
              {profstandardOptions.map((ps) => (
                <option key={ps.id} value={ps.id}>{ps.code} {ps.name}</option>
              ))}
            </select>
            <select
              value={c.profstandard_otf_id ?? ''}
              onChange={(e) => onUpdate({ profstandard_otf_id: e.target.value || null })}
              disabled={!activePsId}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong disabled:opacity-50"
            >
              <option value="">— ОТФ —</option>
              {otfOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.otf_code}{o.level_match ? '' : ' ⚠'} — {o.name.slice(0, 60)}{o.name.length > 60 ? '…' : ''}
                </option>
              ))}
            </select>
          </div>

          {profstandardOptions.length === 0 && (
            <p className="text-xs font-sans text-ink-tertiary">
              Для направления этой программы в реестре ФГОС не найдено ни одного опубликованного профстандарта с ОТФ — сначала добавьте их в /admin/profstandards.
            </p>
          )}

          {selectedOtf && (
            <div className="bg-surface border border-border rounded-md px-3 py-2">
              <p className="text-xs font-sans text-ink leading-relaxed">
                <span className="font-medium">ОТФ {selectedOtf.o.otf_code}:</span> {selectedOtf.o.name}
              </p>
              {selectedOtf.o.education_requirement && (
                <p className="text-[11px] font-sans text-ink-tertiary mt-1">
                  Требования к образованию: {selectedOtf.o.education_requirement}
                </p>
              )}
              {!selectedOtf.o.level_match && (
                <p className="text-[11px] font-sans text-warning mt-1.5">
                  ⚠ Уровень этой ОТФ не совпадает с уровнем программы — проверьте, тот ли уровень квалификации выбран.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Индикаторы</span>
              <button onClick={addIndicator} className="text-xs font-sans text-amber hover:underline">+ добавить</button>
            </div>
            <div className="space-y-1">
              {(c.indicators ?? []).map((ind, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={ind.code} onChange={(e) => updateIndicator(i, { code: e.target.value })}
                    placeholder={`${c.code ?? 'ПК'}.1`}
                    className="w-24 flex-shrink-0 text-xs font-mono bg-surface border border-border rounded-md px-2 py-1.5 focus:border-border-strong outline-none" />
                  <input value={ind.title} onChange={(e) => updateIndicator(i, { title: e.target.value })}
                    placeholder="Формулировка индикатора"
                    className="flex-1 text-xs font-sans bg-surface border border-border rounded-md px-2 py-1.5 focus:border-border-strong outline-none" />
                  <button onClick={() => removeIndicator(i)} className="text-ink-tertiary hover:text-danger px-1 flex-shrink-0">×</button>
                </div>
              ))}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="bg-warning-bg border border-warning/30 rounded-md px-3 py-2 text-xs font-sans text-ink leading-relaxed">
                  <p>{w.detail}</p>
                  <p className="text-ink-secondary mt-1">{w.recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
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

// A true sequential scale (one hue, rising intensity) rather than stapling
// two amber steps to an unrelated green — coverage depth is "how much
// success", not a brand/action signal.
const LEVEL_META: Record<CoverageLevel, { label: string; bg: string }> = {
  introduce: { label: 'Введение', bg: 'rgb(var(--color-success-rgb) / 0.18)' },
  develop:   { label: 'Развитие',  bg: 'rgb(var(--color-success-rgb) / 0.45)' },
  master:    { label: 'Владение',  bg: 'var(--color-success)' },
}

const STATUS_META: Record<CompetencyProgressionRow['status'], { label: string; badge: string }> = {
  ok:        { label: 'Последовательно', badge: 'bg-success-bg text-success' },
  thin:      { label: 'Поверхностно',    badge: 'bg-warning-bg text-warning' },
  late:      { label: 'Поздно',          badge: 'bg-warning-bg text-warning' },
  uncovered: { label: 'Не покрыто',      badge: 'bg-danger-bg text-danger' },
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
        <DisciplineCoverageSection
          disciplines={program.disciplines}
          reviews={reviews}
          documents={program.documents ?? []}
        />
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

// Migration 051 — per-discipline РПД conformance table: does the uploaded
// document actually cover the competencies the discipline claims to develop.
// Fills in incrementally as more disciplines get their РПД uploaded and
// checked from the Documents tab — no requirement that every discipline be
// covered before this renders anything useful.
// Migration 084 — a discipline's CURRENT working_programme document (the
// row with superseded_at === null). Documents lists now include history, so
// every "what's the file on record for this discipline" lookup goes through
// this instead of assuming one row per discipline.
function currentWorkingProgrammeMap(documents: ProgramDocument[]): Map<string, ProgramDocument> {
  return new Map(
    documents.filter((d) => d.kind === 'working_programme' && d.discipline_id && !d.superseded_at)
      .map((d) => [d.discipline_id as string, d])
  )
}

// A review only reflects the file it was run against. Re-upload no longer
// deletes the previous review (migration 084 stopped cascading it away with
// the document row), so a review whose document_id points at a now-
// superseded upload must not be shown as if it checked today's file —
// callers treat a stale match the same as "not reviewed yet".
function currentReviewFor(
  disciplineId:           string | null | undefined,
  reviewByDiscipline:     Map<string | null, ProgramDocumentReview>,
  currentDocByDiscipline: Map<string, ProgramDocument>,
): ProgramDocumentReview | null {
  if (!disciplineId) return null
  const review = reviewByDiscipline.get(disciplineId)
  const doc = currentDocByDiscipline.get(disciplineId)
  return review && doc && review.document_id === doc.id ? review : null
}

function DisciplineCoverageSection({
  disciplines, reviews, documents,
}: {
  disciplines: ProgramDiscipline[]
  reviews:     ProgramDocumentReview[]
  documents:   ProgramDocument[]
}) {
  const reviewByDiscipline = new Map(reviews.map((r) => [r.discipline_id, r]))
  const currentDocByDiscipline = currentWorkingProgrammeMap(documents)
  const currentReview = (disciplineId: string | null | undefined) =>
    currentReviewFor(disciplineId, reviewByDiscipline, currentDocByDiscipline)
  const sorted = [...disciplines].sort((a, b) => a.semester - b.semester || a.sort_order - b.sort_order)
  if (reviews.length === 0) return null   // nothing checked yet — no point rendering an all-empty table

  const checkedCount = disciplines.filter((d) => currentReview(d.id)).length
  const totalCount = disciplines.length

  return (
    <section>
      <SectionLabel>Соответствие РПД компетенциям</SectionLabel>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full bg-surface border border-border rounded-lg divide-y divide-border">
          {sorted.map((d) => {
            const review = currentReview(d.id)
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

// ─── «Топология» tab (docs/topology-spec.md, Increment 1) ──────────────────
//
// Findings are derived client-side from the already-fetched ProgramAnalysis
// (no new backend computation, per the spec's §4.2 "findings first, no
// composite score" decision) — but the GRAPH below reads from the newly
// persisted, id-based program_prerequisites/program_competency_links tables
// (via `topology`), not from this same cached report. That split is
// deliberate: it's what actually proves Increment 0's substrate is real and
// queryable, not just decoration over the existing cached blob.

type FindingKey = 'coverage' | 'progression' | 'control' | 'sequencing' | 'load' | 'duplication'

interface Finding { key: FindingKey; label: string; count: number | null; danger: boolean; note?: string }

function deriveFindings(analysis: ProgramAnalysis): Finding[] {
  const { sequencing, progression, orphans, load_check, mapping_confidence } = analysis
  // Purely a mapping-confidence caveat (docs/topology-spec.md §4.2) — attaches
  // to the three dials whose count depends on the declared competency_codes
  // mapping, so "uncovered" reads as a possible data gap, not an accusation.
  const mappingNote = mapping_confidence?.low
    ? 'Мало дисциплин с заявленными кодами компетенций — возможен пробел в разметке, а не в плане.'
    : undefined

  const uncovered = progression.filter((r) => r.status === 'uncovered').length
  const thinOrLate = progression.filter((r) => r.status === 'thin' || r.status === 'late').length
  const loadIssues = load_check?.issues.length ?? 0

  return [
    { key: 'coverage',    label: 'Покрытие',           count: uncovered,  danger: uncovered > 0,  note: mappingNote },
    { key: 'progression', label: 'Прогрессия',         count: thinOrLate, danger: thinOrLate > 0, note: mappingNote },
    { key: 'control',     label: 'Контроль',           count: null,       danger: false, note: 'Ожидает интеграции ФОС (Increment 3a)' },
    { key: 'sequencing',  label: 'Последовательность', count: sequencing.inversions.length, danger: sequencing.inversions.length > 0 },
    { key: 'load',        label: 'Нагрузка',           count: loadIssues, danger: loadIssues > 0 },
    { key: 'duplication', label: 'Дублирование',       count: orphans.length, danger: orphans.length > 0, note: mappingNote },
  ]
}

// Non-interactive since the graph below moved to its own click-to-select
// mechanic (a discipline/competency node, not a finding tile) — these are
// now purely the six headline counts (docs/topology-spec.md §4.2).
function FindingsGrid({ findings }: { findings: Finding[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {findings.map((f) => (
        <div key={f.key} className="bg-surface border border-border rounded-lg p-4">
          <div className="font-display text-3xl font-bold leading-none" style={{
            color: f.count === null ? 'var(--color-ink-tertiary)' : f.danger ? 'var(--color-danger)' : 'var(--color-ink)',
          }}>
            {f.count === null ? '—' : f.count}
          </div>
          <div className="text-xs font-sans text-ink-secondary mt-1.5">{f.label}</div>
          {f.note && <div className="text-[10px] font-sans text-ink-tertiary mt-1 leading-snug">{f.note}</div>}
        </div>
      ))}
    </div>
  )
}

// Resolves a persisted, id-based prerequisite edge back into the name-based
// PrerequisiteEdge shape EdgeCard already renders — a small mapper, not a
// new card component. Returns null if either discipline was since removed
// (the edge row would be gone too via cascade delete, but guards regardless).
function toPrerequisiteEdge(p: ProgramPrerequisite, disciplineById: Map<string, ProgramDiscipline>): PrerequisiteEdge | null {
  const from = disciplineById.get(p.prerequisite_discipline_id)
  const to = disciplineById.get(p.discipline_id)
  if (!from || !to) return null
  return {
    from_name: from.name, from_semester: from.semester,
    to_name:   to.name,   to_semester:   to.semester,
    reason: p.reason, inverted: p.inverted,
    recommendation: p.inverted
      ? `«${to.name}» (сем. ${to.semester}) опирается на «${from.name}» (сем. ${from.semester}), но изучается раньше.`
      : '',
  }
}

function TopologyTab({
  analysis, topology, program, duration,
}: {
  analysis:  ProgramAnalysis
  topology?: ProgramTopology
  program?:  ProgramDetail
  duration:  number
}) {
  const findings = useMemo(() => deriveFindings(analysis), [analysis])
  const disciplineById = useMemo(() => {
    const m = new Map<string, ProgramDiscipline>()
    for (const d of program?.disciplines ?? []) if (d.id) m.set(d.id, d)
    return m
  }, [program])

  if (!program) return null
  if (!topology) {
    return <div className="text-center py-16 text-sm font-sans text-ink-secondary">Загружаем граф…</div>
  }

  const hasTopologyData = topology.prerequisites.length > 0 || topology.competencyLinks.length > 0
  const invertedEdges = topology.prerequisites
    .filter((p) => p.inverted)
    .map((p) => ({ p, edge: toPrerequisiteEdge(p, disciplineById) }))
    .filter((x): x is { p: ProgramPrerequisite; edge: PrerequisiteEdge } => x.edge != null)

  return (
    <div className="space-y-6">
      {/* Verdict first — "does this student come out fully formed" is the
          actual question, answered before the six dials or the graph. */}
      {analysis.outcome_delivery && <OutcomeDeliveryCard d={analysis.outcome_delivery} />}

      <FindingsGrid findings={findings} />

      {!hasTopologyData && program.disciplines.length > 0 && (
        <div className="text-sm font-sans text-ink-secondary bg-surface border border-border rounded-lg p-4">
          Граф ещё не построен для этой программы. Запустите «Анализировать» на вкладке «Конструктор», чтобы связать дисциплины с компетенциями.
        </div>
      )}

      {hasTopologyData && (
        <>
          <section>
            <SectionLabel>Граф программы</SectionLabel>
            <p className="text-xs font-sans text-ink-tertiary mb-2">
              Дисциплины по семестрам слева направо, компетенции — справа. Нажмите на дисциплину или компетенцию, чтобы увидеть связи.
            </p>
            <CurriculumGraph program={program} topology={topology} duration={duration} analysis={analysis} />
          </section>

          {invertedEdges.length > 0 && (
            <section>
              <SectionLabel>Нарушения последовательности</SectionLabel>
              <div className="space-y-2">
                {invertedEdges.map(({ p, edge }) => <EdgeCard key={p.id} edge={edge} inverted />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// Documents tab — рабочая программа (per discipline) + практики. РПД is
// gathered incrementally, one discipline at a time, never all at once — so
// this renders every discipline in the plan as a row: upload affordance if
// none uploaded yet, otherwise the file + a "Проверить соответствие" trigger
// that checks it against the discipline's declared competency_codes.
function DocumentsPanel({
  programId, documents, disciplines, reviews, placementReviews, mtoReviews,
  canEdit, onChanged, onReviewed, onPlacementReviewed, onMtoReviewed,
}: {
  programId:        string
  documents:        ProgramDocument[]
  disciplines:      ProgramDiscipline[]
  reviews:          ProgramDocumentReview[]
  placementReviews: ProgramPlacementReview[]
  mtoReviews:       ProgramMtoReview[]
  canEdit:          boolean
  onChanged:        () => void
  onReviewed:       () => void
  onPlacementReviewed: () => void
  onMtoReviewed:       () => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [uploading, setUploading] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  // Bulk РПД import from the /sveden/education disclosure page (Feature AD).
  const [svedenOpen, setSvedenOpen] = useState(false)
  // «Ответственный за дисциплину» (docs/RPD-WORKFLOW.md phase 4a) — fetched
  // once for the whole panel, not per row; a programme's teacher pool rarely
  // changes within one editing session.
  const { data: assignableTeachers = [] } = useQuery({
    queryKey: ['assignable-teachers'],
    queryFn: getAssignableTeachers,
  })
  const assignMut = useMutation({
    mutationFn: ({ disciplineId, teacherId }: { disciplineId: string; teacherId: string | null }) =>
      setDisciplineResponsible(programId, disciplineId, teacherId),
    onSuccess: () => { addToast('Ответственный назначен', 'success'); onChanged() },
    onError: () => addToast('Не удалось назначить ответственного', 'error'),
  })
  // Which discipline rows have their inline coverage breakdown open. On a
  // freshly completed review we auto-open the row that was just checked (the
  // user just clicked «Проверить» — the answer should be visible immediately,
  // not one more click away). Toggled by the user thereafter.
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set())
  // Year-over-year diff (migration 084) — mirrors the review state above:
  // per-discipline in-flight flag, fetched result cache, and which rows have
  // their diff panel open.
  const [diffingId, setDiffingId] = useState<string | null>(null)
  const [diffByDiscipline, setDiffByDiscipline] = useState<Map<string, ProgramDocumentDiff>>(new Map())
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set())
  // «Место дисциплины в структуре ОП» (migration 100) — mirrors the coverage
  // review state above.
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [expandedPlacements, setExpandedPlacements] = useState<Set<string>>(new Set())
  // «Материально-техническое обеспечение» (migration 101) — mirrors the
  // placement-review state above.
  const [mtoingId, setMtoingId] = useState<string | null>(null)
  const [expandedMto, setExpandedMto] = useState<Set<string>>(new Set())

  const workingProgrammeByDiscipline = currentWorkingProgrammeMap(documents)
  // ФОС (kind='fos', migration TODO Feature AM) — one CURRENT file per
  // discipline, same supersede-on-reupload contract as working_programme.
  // Only wired to the assessment-linkage check (services/assessmentLinkage.ts);
  // deliberately not the same thing as fos_documents (Feature X's AI-drafted
  // ФОС tied to a personal course).
  const fosByDiscipline = new Map<string, ProgramDocument>()
  for (const d of documents) {
    if (d.kind === 'fos' && d.discipline_id && !d.superseded_at) fosByDiscipline.set(d.discipline_id, d)
  }
  const reviewByDiscipline = new Map(reviews.map((r) => [r.discipline_id, r]))
  const placementByDiscipline = new Map(placementReviews.map((r) => [r.discipline_id, r]))
  const mtoByDiscipline = new Map(mtoReviews.map((r) => [r.discipline_id, r]))
  const practices = documents.filter((d) => d.kind === 'practice')
  // All working_programme versions (current + superseded) per discipline,
  // newest first — powers the «Что изменилось с прошлого года» button's
  // enabled state (needs ≥2) without a separate round trip.
  const versionsByDiscipline = new Map<string, ProgramDocument[]>()
  for (const d of documents) {
    if (d.kind !== 'working_programme' || !d.discipline_id) continue
    const list = versionsByDiscipline.get(d.discipline_id) ?? []
    list.push(d)
    versionsByDiscipline.set(d.discipline_id, list)
  }
  for (const list of versionsByDiscipline.values()) {
    list.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
  }

  async function attachOne(
    input: { kind: ProgramDocumentKind; practiceType?: ProgramPracticeType | null; disciplineId?: string | null }
      & ({ file: File } | { fileUrl: string })
  ) {
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
      // A re-upload supersedes the previous file (migration 084 keeps the old
      // extraction instead of deleting it) — any existing coverage review now
      // refers to that older version, not the one just uploaded.
      if (res.replaced_review) {
        addToast(
          'Предыдущая проверка относится к прежней версии файла — запустите её повторно, чтобы обновить результат.',
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

  async function runDiff(discipline: ProgramDiscipline) {
    if (!discipline.id) return
    const disciplineId = discipline.id
    setDiffingId(disciplineId)
    try {
      const diff = await diffDiscipline(programId, disciplineId)
      setDiffByDiscipline((prev) => new Map(prev).set(disciplineId, diff))
      setExpandedDiffs((prev) => new Set(prev).add(disciplineId))
    } catch {
      // handled by interceptor (e.g. "нет предыдущей версии")
    } finally {
      setDiffingId(null)
    }
  }

  function toggleDiffExpanded(disciplineId: string) {
    setExpandedDiffs((prev) => {
      const next = new Set(prev)
      if (next.has(disciplineId)) next.delete(disciplineId)
      else next.add(disciplineId)
      return next
    })
  }

  async function runPlacement(discipline: ProgramDiscipline) {
    if (!discipline.id) return
    const disciplineId = discipline.id
    setPlacingId(disciplineId)
    try {
      const review = await reviewDisciplinePlacement(programId, disciplineId)
      const errors = review.result.findings.filter((f) => f.severity === 'error').length
      addToast(
        errors > 0 ? `Найдено ошибок: ${errors}` : 'Противоречий не найдено',
        errors > 0 ? 'error' : 'success',
      )
      setExpandedPlacements((prev) => new Set(prev).add(disciplineId))
      onPlacementReviewed()
    } catch {
      // handled by interceptor
    } finally {
      setPlacingId(null)
    }
  }

  function togglePlacementExpanded(disciplineId: string) {
    setExpandedPlacements((prev) => {
      const next = new Set(prev)
      if (next.has(disciplineId)) next.delete(disciplineId)
      else next.add(disciplineId)
      return next
    })
  }

  async function runMto(discipline: ProgramDiscipline) {
    if (!discipline.id) return
    const disciplineId = discipline.id
    setMtoingId(disciplineId)
    try {
      const review = await reviewDisciplineMto(programId, disciplineId)
      const errors = review.result.findings.filter((f) => f.severity === 'error').length
      addToast(
        errors > 0 ? `Найдено ошибок: ${errors}` : 'Противоречий не найдено',
        errors > 0 ? 'error' : 'success',
      )
      setExpandedMto((prev) => new Set(prev).add(disciplineId))
      onMtoReviewed()
    } catch {
      // handled by interceptor
    } finally {
      setMtoingId(null)
    }
  }

  function toggleMtoExpanded(disciplineId: string) {
    setExpandedMto((prev) => {
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
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Рабочие программы дисциплин</SectionLabel>
          {canEdit && disciplines.length > 0 && (
            <button
              onClick={() => setSvedenOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium px-2.5 py-1.5 rounded-md border border-amber/50 bg-amber-light/60 text-amber hover:bg-amber-light transition-colors"
              title="Вставьте ссылку на страницу «Сведения → Образование» сайта вуза — ИСПУМ найдёт и загрузит все РПД и практики программы разом"
            >
              <Icon name="import" size={14} />
              Импортировать со страницы сведений
            </button>
          )}
        </div>
        {svedenOpen && (
          <SvedenImportModal
            programId={programId}
            disciplines={disciplines}
            onClose={() => setSvedenOpen(false)}
            onImported={onChanged}
          />
        )}
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
                review={currentReviewFor(d.id, reviewByDiscipline, workingProgrammeByDiscipline)}
                expanded={d.id ? expandedReviews.has(d.id) : false}
                onToggleExpanded={() => d.id && toggleExpanded(d.id)}
                versionCount={d.id ? versionsByDiscipline.get(d.id)?.length ?? 0 : 0}
                diff={d.id ? diffByDiscipline.get(d.id) ?? null : null}
                diffExpanded={d.id ? expandedDiffs.has(d.id) : false}
                onToggleDiffExpanded={() => d.id && toggleDiffExpanded(d.id)}
                diffing={diffingId === d.id}
                onDiff={() => runDiff(d)}
                programId={programId}
                canEdit={canEdit}
                uploading={uploading}
                reviewing={reviewingId === d.id}
                onUpload={(file) => attachOne({ file, kind: 'working_programme', disciplineId: d.id })}
                onUploadUrl={(fileUrl) => attachOne({ fileUrl, kind: 'working_programme', disciplineId: d.id })}
                onRemove={(doc) => removeOne(doc)}
                fosDoc={d.id ? fosByDiscipline.get(d.id) ?? null : null}
                onUploadFos={(file) => attachOne({ file, kind: 'fos', disciplineId: d.id })}
                onRemoveFos={(doc) => removeOne(doc)}
                onReview={() => runReview(d)}
                placementReview={d.id ? placementByDiscipline.get(d.id) ?? null : null}
                placementExpanded={d.id ? expandedPlacements.has(d.id) : false}
                onTogglePlacementExpanded={() => d.id && togglePlacementExpanded(d.id)}
                placing={placingId === d.id}
                onPlacementReview={() => runPlacement(d)}
                mtoReview={d.id ? mtoByDiscipline.get(d.id) ?? null : null}
                mtoExpanded={d.id ? expandedMto.has(d.id) : false}
                onToggleMtoExpanded={() => d.id && toggleMtoExpanded(d.id)}
                mtoing={mtoingId === d.id}
                onMtoReview={() => runMto(d)}
                assignableTeachers={assignableTeachers}
                assigning={assignMut.isPending && assignMut.variables?.disciplineId === d.id}
                onAssignResponsible={(teacherId) => d.id && assignMut.mutate({ disciplineId: d.id, teacherId })}
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
              onSubmit={(input) =>
                'file' in input
                  ? attachOne({ file: input.file, kind: 'practice', practiceType: input.type })
                  : attachOne({ fileUrl: input.fileUrl, kind: 'practice', practiceType: input.type })
              }
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

// A discrete action in a discipline's action row. Rendered as a bordered chip
// (not a bare text link) so a row of actions reads as separate buttons rather
// than a run-on sentence, and so toggles clearly look clickable. `variant`
// gives the primary action emphasis; `expanded` (when defined) marks a
// show/hide toggle and renders a rotating chevron.
function RowActionChip({
  onClick, disabled, title, variant = 'neutral', expanded, children,
}: {
  onClick:   () => void
  disabled?: boolean
  title?:    string
  variant?:  'primary' | 'neutral'
  expanded?: boolean
  children:  ReactNode
}) {
  const styles = variant === 'primary'
    ? 'border-amber/50 bg-amber-light/60 text-amber font-medium hover:bg-amber-light'
    : 'border-border-mid text-ink-secondary hover:border-amber/60 hover:text-amber'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 text-xs font-sans px-2.5 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-mid disabled:hover:text-ink-secondary ${styles}`}
    >
      {children}
      {expanded !== undefined && (
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      )}
    </button>
  )
}

// «Ответственный за дисциплину» (docs/RPD-WORKFLOW.md phase 4a) — who must
// author and submit this discipline's РПД. A plain display + "Изменить"
// toggle rather than an always-open select: most disciplines, most of the
// time, aren't being reassigned, and a bare select sitting open on every row
// reads as "click here" noise across a long plan.
function ResponsibleTeacherControl({
  discipline, teachers, canEdit, assigning, onAssign,
}: {
  discipline: ProgramDiscipline
  teachers:   AssignableTeacher[]
  canEdit:    boolean
  assigning:  boolean
  onAssign:   (teacherId: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  if (!canEdit) {
    return discipline.responsible_teacher_name ? (
      <div className="text-[11px] font-sans text-ink-tertiary mt-0.5">
        Ответственный: {discipline.responsible_teacher_name}
      </div>
    ) : null
  }

  if (editing || (!discipline.responsible_teacher_id && teachers.length > 0)) {
    return (
      <div className="mt-1 max-w-[280px] flex items-center gap-2">
        <Select
          value={discipline.responsible_teacher_id ?? ''}
          onChange={(v) => { onAssign(v || null); setEditing(false) }}
          options={[
            { value: '', label: 'Не назначен' },
            ...teachers.map((t) => ({ value: t.id, label: t.name ?? t.email })),
          ]}
          ariaLabel="Ответственный за дисциплину"
          size="sm"
        />
        {assigning && <LoadingSpinner size={13} />}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <span className="text-[11px] font-sans text-ink-tertiary">
        Ответственный: {discipline.responsible_teacher_name ?? 'не назначен'}
      </span>
      <button
        onClick={() => setEditing(true)}
        className="text-[11px] font-sans text-amber hover:underline"
      >
        Изменить
      </button>
    </div>
  )
}

// One discipline's РПД slot: upload affordance if empty, otherwise the file
// plus a "Проверить соответствие" trigger that scores it against the
// discipline's declared competency_codes (disabled with an explanatory
// tooltip if none are declared — nothing to check against).
function DisciplineDocumentRow({
  discipline, doc, review, expanded, onToggleExpanded,
  versionCount, diff, diffExpanded, onToggleDiffExpanded, diffing, onDiff,
  programId, canEdit, uploading, reviewing, onUpload, onUploadUrl, onRemove, onReview,
  placementReview, placementExpanded, onTogglePlacementExpanded, placing, onPlacementReview,
  mtoReview, mtoExpanded, onToggleMtoExpanded, mtoing, onMtoReview,
  assignableTeachers, assigning, onAssignResponsible,
  fosDoc, onUploadFos, onRemoveFos,
}: {
  discipline:            ProgramDiscipline
  doc:                   ProgramDocument | null
  review:                ProgramDocumentReview | null
  expanded:              boolean
  onToggleExpanded:      () => void
  // Year-over-year diff (migration 084) — versionCount counts ALL uploads
  // for this discipline (current + superseded); the button needs ≥2.
  versionCount:          number
  diff:                  ProgramDocumentDiff | null
  diffExpanded:          boolean
  onToggleDiffExpanded:  () => void
  diffing:               boolean
  onDiff:                () => void
  programId:             string
  canEdit:               boolean
  uploading:             boolean
  reviewing:             boolean
  onUpload:              (file: File) => void
  onUploadUrl:           (url: string) => void
  onRemove:              (doc: ProgramDocument) => void
  onReview:              () => void
  // «Место дисциплины в структуре ОП» (migration 100)
  placementReview:            ProgramPlacementReview | null
  placementExpanded:          boolean
  onTogglePlacementExpanded:  () => void
  placing:                    boolean
  onPlacementReview:          () => void
  // «Материально-техническое обеспечение» (migration 101)
  mtoReview:            ProgramMtoReview | null
  mtoExpanded:          boolean
  onToggleMtoExpanded:  () => void
  mtoing:               boolean
  onMtoReview:          () => void
  assignableTeachers:    AssignableTeacher[]
  assigning:             boolean
  onAssignResponsible:   (teacherId: string | null) => void
  // ФОС (kind='fos') — same supersede-on-reupload contract as `doc` above,
  // used only to power a real ФОС chip in «Проверка дисциплины»'s связка
  // check instead of an unconditional "проверьте вручную" reminder.
  fosDoc:       ProgramDocument | null
  onUploadFos:  (file: File) => void
  onRemoveFos:  (doc: ProgramDocument) => void
}) {
  const hasCodes = discipline.competency_codes.length > 0
  const kb = doc ? Math.round(doc.file_size / 1024) : 0
  const counts = review ? countByStatus(review.result.items) : null

  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const [openingStudio, setOpeningStudio] = useState(false)

  // Bridge into РПД-студия: the студия works off the caller's personal
  // «Предметы», so the server find-or-creates one seeded with this РПД's
  // text and we navigate straight to it.
  async function openInStudio() {
    if (!doc || !discipline.id) return
    setOpeningStudio(true)
    try {
      const { course_id } = await openDisciplineInStudio(programId, discipline.id)
      // The sidebar/студия share the 'courses' cache — a just-created предмет
      // must show up in the студия's picker immediately.
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      navigate(`/curriculum?tab=studio&course=${course_id}`)
    } catch {
      setOpeningStudio(false) /* toast handled by interceptor */
    }
  }

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
          <ResponsibleTeacherControl
            discipline={discipline}
            teachers={assignableTeachers}
            canEdit={canEdit}
            assigning={assigning}
            onAssign={onAssignResponsible}
          />
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
      {canEdit && (
        <div className="mt-2 pl-8">
          <UrlUploadField
            onSubmit={onUploadUrl}
            busy={uploading}
            label={doc ? 'заменить по ссылке' : 'или загрузить по ссылке'}
          />
        </div>
      )}
      <div className="mt-2.5 pl-8 flex items-center gap-2.5 flex-wrap">
        <span className="text-[11px] font-sans text-ink-tertiary uppercase tracking-wider">ФОС</span>
        {fosDoc ? (
          <>
            <span className="text-xs font-sans text-ink-secondary truncate">{fosDoc.file_name}</span>
            {canEdit && (
              <button onClick={() => onRemoveFos(fosDoc)} className="text-xs font-sans text-ink-tertiary hover:text-danger transition-colors">Удалить</button>
            )}
          </>
        ) : (
          <span className="text-xs font-sans text-ink-tertiary">Не загружен — связка с ФОС не проверяется</span>
        )}
        {canEdit && (
          <UploadPill label={fosDoc ? 'Заменить' : 'Загрузить'} onPick={onUploadFos} disabled={uploading} />
        )}
      </div>
      {doc && (
        <div className="mt-2.5 pl-8 flex flex-wrap items-center gap-2">
          {canEdit && (
            <RowActionChip
              onClick={onReview}
              disabled={reviewing || !hasCodes}
              // Emphasise while unchecked; calm to neutral once a review exists.
              variant={review ? 'neutral' : 'primary'}
              title={hasCodes ? undefined : 'У дисциплины не указаны компетенции — заполните их в конструкторе плана'}
            >
              {reviewing ? 'Проверяем…' : review ? 'Перепроверить соответствие' : 'Проверить соответствие компетенциям'}
            </RowActionChip>
          )}
          <RowActionChip
            onClick={openInStudio}
            disabled={openingStudio}
            title="Доработать содержание этой РПД в студии — создаст (или откроет) ваш личный предмет с текстом РПД"
          >
            {openingStudio ? 'Открываем…' : 'Открыть в РПД-студии'}
          </RowActionChip>
          {canEdit && review && (
            <RowActionChip onClick={onToggleExpanded} expanded={expanded}>
              {expanded ? 'Скрыть разбор' : 'Показать разбор'}
            </RowActionChip>
          )}
          {canEdit && (
            <RowActionChip
              onClick={diff ? onToggleDiffExpanded : onDiff}
              disabled={diffing || versionCount < 2}
              title={versionCount < 2 ? 'Появится после повторной загрузки обновлённого файла для этой дисциплины' : undefined}
              expanded={diff ? diffExpanded : undefined}
            >
              {diffing ? 'Сравниваем…' : diff ? (diffExpanded ? 'Скрыть изменения' : 'Показать изменения') : 'Что изменилось с прошлого года'}
            </RowActionChip>
          )}
          {canEdit && (
            <RowActionChip
              onClick={onPlacementReview}
              disabled={placing}
              variant={placementReview ? 'neutral' : 'primary'}
              title="Проверяет раздел «Место дисциплины в структуре ОП» — предшествующие/последующие дисциплины — против учебного плана"
            >
              {placing ? 'Проверяем…' : placementReview ? 'Перепроверить место в структуре' : 'Проверить место в структуре'}
            </RowActionChip>
          )}
          {canEdit && placementReview && (
            <RowActionChip onClick={onTogglePlacementExpanded} expanded={placementExpanded}>
              {placementExpanded ? 'Скрыть разбор' : 'Показать разбор'}
            </RowActionChip>
          )}
          {canEdit && (
            <RowActionChip
              onClick={onMtoReview}
              disabled={mtoing}
              variant={mtoReview ? 'neutral' : 'primary'}
              title="Проверяет раздел «Материально-техническое обеспечение» — конкретное ПО vs. общие аудиторные средства, согласованность с содержанием лабораторных/практических"
            >
              {mtoing ? 'Проверяем…' : mtoReview ? 'Перепроверить МТО' : 'Проверить МТО'}
            </RowActionChip>
          )}
          {canEdit && mtoReview && (
            <RowActionChip onClick={onToggleMtoExpanded} expanded={mtoExpanded}>
              {mtoExpanded ? 'Скрыть разбор' : 'Показать разбор'}
            </RowActionChip>
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
      {diff && diffExpanded && (
        <div className="mt-3 pl-8 pr-1 border-t border-border pt-3">
          <DocumentDiffPanel diff={diff} />
        </div>
      )}
      {placementReview && placementExpanded && (
        <div className="mt-3 pl-8 pr-1 border-t border-border pt-3">
          <PlacementReviewPanel review={placementReview} />
        </div>
      )}
      {mtoReview && mtoExpanded && (
        <div className="mt-3 pl-8 pr-1 border-t border-border pt-3">
          <MtoReviewPanel review={mtoReview} />
        </div>
      )}
    </div>
  )
}

const DIFF_KIND_META: Record<DiffChangeKind, { label: string; color: string }> = {
  added:   { label: 'добавлено', color: 'var(--color-success)' },
  removed: { label: 'убрано',    color: 'var(--color-danger)' },
  changed: { label: 'изменено',  color: 'var(--color-warning)' },
}

// «Что изменилось с прошлого года» (migration 084, Research.md §9.6) — a
// structured report, not a text diff: three groups (темы / компетенции /
// формы контроля), each entry colored by DiffChangeKind. Same visual
// language as CoverageItemRow (border-l + status color + evidence quote).
function DocumentDiffPanel({ diff }: { diff: ProgramDocumentDiff }) {
  const { result } = diff
  if (result.unchanged) {
    return (
      <p className="text-xs font-sans text-ink-secondary leading-relaxed">
        {result.summary || 'Существенных изменений с прошлой версии не обнаружено.'}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {result.summary && (
        <p className="text-xs font-sans text-ink-secondary leading-relaxed">{result.summary}</p>
      )}
      <DiffGroup title="Темы">
        {result.topics.map((t, i) => (
          <div key={i} className="text-xs font-sans border-l-2 pl-2.5" style={{ borderColor: DIFF_KIND_META[t.kind].color }}>
            <div className="flex items-center gap-2">
              <span className="text-ink font-medium">{t.topic}</span>
              <span style={{ color: DIFF_KIND_META[t.kind].color }}>{DIFF_KIND_META[t.kind].label}</span>
            </div>
            {t.detail && <div className="text-ink-secondary mt-0.5">{t.detail}</div>}
            {t.evidence && <div className="text-ink-tertiary italic mt-0.5">«{t.evidence}»</div>}
          </div>
        ))}
      </DiffGroup>
      <DiffGroup title="Компетенции">
        {result.competencies.map((c, i) => (
          <div key={i} className="text-xs font-sans border-l-2 pl-2.5" style={{ borderColor: DIFF_KIND_META[c.kind].color }}>
            <div className="flex items-center gap-2">
              <span className="text-ink font-medium">{c.code ? `${c.code} — ${c.title}` : c.title}</span>
              <span style={{ color: DIFF_KIND_META[c.kind].color }}>{DIFF_KIND_META[c.kind].label}</span>
            </div>
            {c.detail && <div className="text-ink-secondary mt-0.5">{c.detail}</div>}
          </div>
        ))}
      </DiffGroup>
      <DiffGroup title="Формы контроля">
        {result.assessment.map((a, i) => (
          <div key={i} className="text-xs font-sans border-l-2 pl-2.5" style={{ borderColor: DIFF_KIND_META[a.kind].color }}>
            <div className="flex items-center gap-2">
              <span className="text-ink font-medium">{a.form}</span>
              <span style={{ color: DIFF_KIND_META[a.kind].color }}>{DIFF_KIND_META[a.kind].label}</span>
            </div>
            {a.detail && <div className="text-ink-secondary mt-0.5">{a.detail}</div>}
          </div>
        ))}
      </DiffGroup>
    </div>
  )
}

function DiffGroup({ title, children }: { title: string; children: ReactNode[] }) {
  if (children.length === 0) return null
  return (
    <div>
      <div className="text-[11px] font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1.5">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
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
  onSubmit:  (input: { type: ProgramPracticeType } & ({ file: File } | { fileUrl: string })) => void
}) {
  const [type, setType] = useState<ProgramPracticeType | ''>('')
  const ref = useMemo(() => ({ current: null as HTMLInputElement | null }), [])

  function handlePick(f: File) {
    if (!type) return
    onSubmit({ file: f, type })
    setType('')
  }

  function handleUrl(url: string) {
    if (!type) return
    onSubmit({ fileUrl: url, type })
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
      {/* Выбор типа обязателен и для ссылки — держим поле неактивным до выбора. */}
      {type && <UrlUploadField onSubmit={handleUrl} busy={disabled} />}
    </div>
  )
}
