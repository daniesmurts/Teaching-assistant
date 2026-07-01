import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import {
  getProgram, getAnalysis, saveDisciplines, saveCompetencies, analyzeProgram, deleteProgram,
  downloadAnalysisPdf, updateProgram, uploadProgramDocument, deleteProgramDocument,
  downloadProgramDocument,
} from '../../api/programs'
import { getCourses } from '../../api/courses'
import { getPickableProgramUnits } from '../../api/programs'
import {
  PROGRAM_PRACTICE_LABEL, PROGRAM_PRACTICE_TYPES,
  type ProgramDocument, type ProgramPracticeType,
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
                <option key={u.id} value={u.id}>{u.name}{u.short_name ? ` (${u.short_name})` : ''}</option>
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
              ? <Report analysis={analysis} duration={maxSemester} program={program} />
              : <div className="text-center py-16 text-sm font-sans text-ink-secondary">
                  Анализ ещё не запускался. Нажмите «Анализировать», чтобы оценить архитектуру плана.
                </div>
        )}

        {tab === 'documents' && program && (
          <DocumentsPanel
            programId={program.id}
            documents={program.documents ?? []}
            canEdit={canEdit}
            onChanged={() => qc.invalidateQueries({ queryKey: ['program', id] })}
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

function Report({ analysis, duration, program }: { analysis: ProgramAnalysis; duration: number; program?: ProgramDetail }) {
  const { sequencing, progression, orphans, missing, clusters, isolated, load } = analysis
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
      {/* Export */}
      <div className="flex justify-end -mb-2">
        <Button variant="secondary" size="sm" onClick={exportPdf} loading={downloading} disabled={!program}>
          Экспорт в PDF
        </Button>
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
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-xs font-sans border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-ink-secondary sticky left-0 bg-surface">Компетенция</th>
                  {Array.from({ length: duration }, (_, i) => i + 1).map((s) => (
                    <th key={s} className="px-1 py-2 font-medium text-ink-tertiary text-center w-7">{s}</th>
                  ))}
                  <th className="px-3 py-2 font-medium text-ink-secondary text-right">Статус</th>
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
        </section>
      )}

      {/* Gaps & redundancy */}
      {(orphans.length > 0 || missing.length > 0) && (
        <section>
          <SectionLabel>Пробелы и избыточность</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GapColumn title="Нет вклада в компетенции (кандидаты на исключение)" items={orphans} tone="warning" />
            <GapColumn title="Компетенции без дисциплины (нужно добавить)" items={missing} tone="danger" />
          </div>
        </section>
      )}

      {/* Relatedness & load */}
      <section>
        <SectionLabel>Связность и нагрузка</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>
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

// Documents tab — рабочая программа + практики. Grouped by kind; each row has
// a download link and (when the caller can edit) a delete affordance. Upload
// controls at the bottom let editors attach a new document after import.
function DocumentsPanel({
  programId, documents, canEdit, onChanged,
}: {
  programId: string
  documents: ProgramDocument[]
  canEdit:   boolean
  onChanged: () => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [uploading, setUploading] = useState(false)

  const workingProgramme = documents.filter((d) => d.kind === 'working_programme')
  const practices        = documents.filter((d) => d.kind === 'practice')

  async function attachOne(input: { file: File; kind: 'working_programme' | 'practice'; practiceType?: ProgramPracticeType | null }) {
    setUploading(true)
    try {
      await uploadProgramDocument(programId, input)
      addToast('Документ добавлен', 'success')
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

  return (
    <div className="space-y-8">
      {/* Working programme */}
      <div>
        <SectionLabel>Рабочая программа</SectionLabel>
        {workingProgramme.length === 0 ? (
          <p className="text-sm font-sans text-ink-secondary bg-surface border border-border rounded-lg px-4 py-3">
            Не загружена.
          </p>
        ) : (
          <div className="space-y-2">
            {workingProgramme.map((d) => (
              <DocumentRow key={d.id} doc={d} programId={programId} canEdit={canEdit} onRemove={() => removeOne(d)} />
            ))}
          </div>
        )}
        {canEdit && workingProgramme.length === 0 && (
          <div className="mt-2">
            <UploadPill
              label="Добавить рабочую программу"
              onPick={(file) => attachOne({ file, kind: 'working_programme' })}
              disabled={uploading}
            />
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
