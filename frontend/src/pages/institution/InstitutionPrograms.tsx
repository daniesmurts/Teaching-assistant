import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import UrlUploadField from '../../components/ui/UrlUploadField'
import { listPrograms, importProgram, getPickableProgramUnits } from '../../api/programs'
import { PROGRAM_PRACTICE_LABEL, PROGRAM_PRACTICE_TYPES, EDUCATION_LEVELS, STUDY_FORMS, type ProgramPracticeType } from '../../types'
import { useUIStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import type { Program, ProgramLevel } from '../../types'

const LEVEL_LABEL: Record<ProgramLevel, string> = {
  bachelor: 'Бакалавриат', master: 'Магистратура', specialist: 'Специалитет',
}

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function InstitutionPrograms() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const programAccess = useAuthStore((s) => s.teacher?.program_access) ?? 'none'
  // 'all-rw' (IT admin, УМЦ, проректор) and 'specific' (РОП, polygroup head,
  // institute director — anyone with a subtree containing `program` units)
  // can both import. 'all-ro' is reserved for a future viewer role — no
  // active role maps to it today. `none` sees nothing.
  const canImport = programAccess === 'all-rw' || programAccess === 'specific'
  const readOnly  = programAccess === 'all-ro'
  // Server picks the right unit set per scope; frontend just renders it. If
  // this ends up as a single option we auto-select; if empty for a scoped
  // caller we hide the picker (no valid choice exists).
  const isScoped  = programAccess === 'specific'

  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [specialtyName, setSpecialtyName] = useState('')
  const [educationLevel, setEducationLevel] = useState('')
  const [profile, setProfile] = useState('')
  const [forms, setForms] = useState('')
  const [orgUnitId, setOrgUnitId] = useState<string>('')
  const [descFile, setDescFile] = useState<File | null>(null)
  const [planFile, setPlanFile] = useState<File | null>(null)
  // Alternative to uploading: a link to the file in the university's system
  // (server fetches it). A field holds a file OR a url, never both.
  const [descUrl, setDescUrl] = useState<string | null>(null)
  const [planUrl, setPlanUrl] = useState<string | null>(null)
  const [practices, setPractices] = useState<{ file: File | null; type: ProgramPracticeType | '' }[]>([])
  const descRef = useRef<HTMLInputElement>(null)
  const planRef = useRef<HTMLInputElement>(null)

  function addPractice() {
    if (practices.length >= 8) return
    setPractices((prev) => [...prev, { file: null, type: '' }])
  }
  function updatePractice(i: number, patch: Partial<{ file: File | null; type: ProgramPracticeType | '' }>) {
    setPractices((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function removePractice(i: number) {
    setPractices((prev) => prev.filter((_, idx) => idx !== i))
  }

  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: listPrograms })

  // Program-unit options for the linker — single endpoint scoped by the
  // server. РОП: only their directly-held program units. Polygroup /
  // institute head: every `program` unit walked out of their subtree. IT
  // admin / УМЦ: every program unit in the institution.
  const { data: programUnitOptions = [] } = useQuery({
    queryKey: ['program-pickable-units'],
    queryFn:  getPickableProgramUnits,
    enabled:  canImport,
  })

  // Auto-pick when there's exactly one option — friction-free for the common
  // РОП-with-one-programme case; the picker still renders for clarity.
  useEffect(() => {
    if (!orgUnitId && programUnitOptions.length === 1) {
      setOrgUnitId(programUnitOptions[0].id)
    }
  }, [programUnitOptions, orgUnitId])

  // Prefill the ФГОС header from the picked unit's metadata (set by the admin
  // on the org tree) so the РОП doesn't retype it. Only overwrites fields the
  // unit actually carries — a unit with no metadata leaves anything typed
  // intact. Профиль is deliberately NOT prefilled: it's per-programme (one
  // направление hosts several profiles), so it stays the РОП's to fill.
  useEffect(() => {
    if (!orgUnitId) return
    const u = programUnitOptions.find((x) => x.id === orgUnitId)
    if (!u) return
    if (u.code)            setCode(u.code)
    if (u.specialty_name)  setSpecialtyName(u.specialty_name)
    if (u.education_level) setEducationLevel(u.education_level)
    if (u.forms_of_study)  setForms(u.forms_of_study)
  }, [orgUnitId, programUnitOptions])

  const importMut = useMutation({
    mutationFn: () => importProgram({
      code: code.trim(),
      specialty_name: specialtyName.trim(),
      education_level: educationLevel.trim(),
      profile: profile.trim(),
      forms_of_study: forms.trim(),
      description: descFile,
      descriptionUrl: descUrl ?? undefined,
      plan: planFile,
      planUrl: planUrl ?? undefined,
      org_unit_id: orgUnitId || null,
      // Only pass practices that have BOTH a file and a type set — half-filled
      // rows are dropped silently. Backend enforces the parallel-length rule.
      practices: practices
        .filter((p): p is { file: File; type: ProgramPracticeType } => p.file !== null && p.type !== '')
        .map((p) => ({ file: p.file, type: p.type })),
    }),
    onSuccess: ({ program, imported, warnings }) => {
      qc.invalidateQueries({ queryKey: ['programs'] })
      addToast(`Импортировано: ${imported.disciplines} дисциплин, ${imported.competencies} компетенций`, 'success')
      if (warnings && warnings.length > 0) addToast(warnings[0], 'info')
      navigate(`/programs/${program.id}`)
    },
  })

  function submit() {
    if (specialtyName.trim().length < 2) { addToast('Укажите наименование специальности/направления', 'error'); return }
    if (!planFile && !planUrl) { addToast('Загрузите учебный план (PDF) или вставьте ссылку на него', 'error'); return }
    // Scoped callers (РОП, polygroup / institute heads) must link to a program
    // unit before importing — the backend enforces this too but a client-side
    // check gives a clearer error.
    if (isScoped && !orgUnitId) {
      addToast('Выберите образовательную программу в структуре', 'error'); return
    }
    // Any practice row that has half-set values (file without type, or type
    // without file) is user intent to add something — refuse to silently drop it.
    for (let i = 0; i < practices.length; i++) {
      const p = practices[i]
      const hasFile = p.file !== null
      const hasType = p.type !== ''
      if (hasFile !== hasType) {
        addToast(`Практика ${i + 1}: выберите и файл, и тип`, 'error')
        return
      }
    }
    importMut.mutate()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Образовательные программы</h1>
            <p className="text-sm font-sans text-ink-secondary mt-1">
              Анализ архитектуры образовательных программ — последовательность, компетенции, пробелы
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            {readOnly && (
              <span
                title="Вы видите все программы организации только для чтения. Редактировать может назначенный РОП или администратор организации."
                className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary bg-surface-warm border border-border rounded-sm px-2 py-1"
              >
                Только просмотр
              </span>
            )}
            {/* Single primary CTA — the import action, clearly distinct from the
                list below (which is content, not an action). */}
            {canImport && (
              <button
                onClick={() => setCreating((v) => !v)}
                aria-expanded={creating}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity ${
                  programs.length === 0 && !creating ? 'cta-pulse' : ''
                }`}
              >
                {creating
                  ? <><CloseGlyph /> Закрыть</>
                  : <><PlusGlyph /> Импортировать программу</>}
              </button>
            )}
          </div>
        </div>

        {/* Intro copy — analysis-first framing. Programme content is authored
            in the university's own system; here we ingest, correct extracted
            data, and analyse. */}
        {readOnly ? (
          <FeatureIntro
            id="programs-oversight"
            title="Что здесь"
            description="Обзор архитектуры всех образовательных программ организации — дисциплины, компетенции, цели и результаты анализа. Только для просмотра."
            steps={[
              'Выберите программу из списка ниже, чтобы открыть её карточку',
              'На вкладке «Конструктор» — дисциплины по семестрам и карта компетенций',
              'На вкладке «Анализ» — последовательность, покрытие компетенций, пробелы',
            ]}
          />
        ) : (
          <FeatureIntro
            id="programs-v2"
            title="Как это работает"
            description="Инструмент анализа образовательных программ. Импортируйте описание ОП и учебный план (PDF из вашей университетской системы) — ИСПУМ извлечёт дисциплины и компетенции, а затем проверит последовательность, покрытие ФГОС ВО, пробелы и избыточность. Программа создаётся в вашей университетской системе — здесь только её анализ."
            steps={[
              'Импортируйте описание ОП и учебный план (PDF)',
              'При необходимости отредактируйте извлечённые дисциплины и компетенции',
              'Запустите анализ — последовательность, карта компетенций и рекомендации',
            ]}
          />
        )}

        {/* Intake — РОП, УМЦ, проректор, IT admin can all import. Opened via the
            header CTA; rendered as a distinct amber-tinted panel so it reads as
            an input zone, never as another list card. */}
        {canImport && creating && (
        <div className="bg-surface-warm border border-amber/30 rounded-lg overflow-hidden mb-6 result-appear">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber/20 bg-amber-light/40">
            <span className="text-sm font-sans font-medium text-ink">Новая программа — импорт из документов</span>
            <button
              onClick={() => setCreating(false)} aria-label="Закрыть форму"
              className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none"
            >×</button>
          </div>

            <div className="px-4 pb-4 pt-3 space-y-3">
              {/* Program-unit linker FIRST — picking the unit prefills the ФГОС
                  header below from the metadata the admin recorded on the tree.
                  Required for scoped callers (РОП, polygroup / institute heads:
                  picker restricted to their subtree); optional for all-rw. */}
              {programUnitOptions.length > 0 && (
                <label className="block">
                  <span className="text-xs font-sans text-ink-secondary block mb-1">
                    Подразделение в структуре {isScoped && <span className="text-danger">*</span>}
                    {!isScoped && <span className="text-ink-tertiary"> — необязательно, можно связать позже</span>}
                  </span>
                  <select
                    value={orgUnitId}
                    onChange={(e) => setOrgUnitId(e.target.value)}
                    className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-2 outline-none focus:border-border-strong"
                  >
                    {!isScoped && <option value="">— не связывать сейчас —</option>}
                    {isScoped && programUnitOptions.length > 1 && <option value="" disabled>Выберите программу</option>}
                    {programUnitOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.type_code === 'program_direction' ? 'Направление: ' : 'ОП: '}
                        {u.name}{u.short_name ? ` (${u.short_name})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] font-sans text-ink-tertiary block mt-1">
                    {isScoped
                      ? 'Выберите образовательную программу, за которую вы отвечаете (или которая входит в ваше направление / институт). Данные ниже подставятся автоматически, если администратор их заполнил.'
                      : 'При выборе подразделения код, наименование, уровень и формы подставятся из структуры, если администратор их заполнил.'}
                  </span>
                </label>
              )}

              <Field label="Код" value={code} onChange={setCode} placeholder="09.03.01" mono />
              <Field
                label="Наименование профессии / специальности / направления подготовки / группы научных специальностей"
                value={specialtyName} onChange={setSpecialtyName}
                placeholder="Информатика и вычислительная техника"
              />
              <label className="block">
                <span className="text-xs font-sans text-ink-secondary block mb-1">Уровень образования</span>
                <select
                  value={educationLevel} onChange={(e) => setEducationLevel(e.target.value)}
                  className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-2 outline-none focus:border-border-strong"
                >
                  <option value="">— выберите —</option>
                  {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  {/* Preserve a prefilled value that isn't in the standard list */}
                  {educationLevel && !EDUCATION_LEVELS.includes(educationLevel) && (
                    <option value={educationLevel}>{educationLevel}</option>
                  )}
                </select>
              </label>
              <Field
                label="Образовательная программа / направленность / профиль, шифр и наименование научной специальности"
                value={profile} onChange={setProfile} placeholder="Профиль «Программная инженерия»"
              />
              <div>
                <span className="text-xs font-sans text-ink-secondary block mb-1">Реализуемые формы обучения</span>
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const set = new Set(forms.split(',').map((s) => s.trim()).filter(Boolean))
                    return STUDY_FORMS.map((f) => (
                      <label key={f} className="inline-flex items-center gap-1.5 text-sm font-sans text-ink cursor-pointer">
                        <input
                          type="checkbox" checked={set.has(f)}
                          onChange={() => {
                            const next = new Set(set)
                            if (next.has(f)) next.delete(f); else next.add(f)
                            setForms(STUDY_FORMS.filter((x) => next.has(x)).join(', '))
                          }}
                          className="accent-amber"
                        />
                        {f}
                      </label>
                    ))
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <FileField
                  label="Описание образовательной программы (PDF)"
                  file={descFile} inputRef={descRef}
                  onPick={(f) => { setDescFile(f); if (f) setDescUrl(null) }}
                  url={descUrl}
                  onPickUrl={(u) => { setDescUrl(u); if (u) setDescFile(null) }}
                />
                <FileField
                  label="Учебный план (PDF) — обязательно"
                  file={planFile} inputRef={planRef}
                  onPick={(f) => { setPlanFile(f); if (f) setPlanUrl(null) }}
                  url={planUrl}
                  onPickUrl={(u) => { setPlanUrl(u); if (u) setPlanFile(null) }}
                  required
                />
              </div>

              {/* Migration 051 — рабочая программа is per-discipline, gathered */}
              {/* incrementally, not at intake. Attach it later from the */}
              {/* programme's Documents tab once disciplines exist. */}

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-sans font-medium text-ink-secondary">
                    Практики <span className="text-ink-tertiary">— необязательно, до 4 файлов, каждый со своим типом</span>
                  </span>
                  {practices.length < 4 && (
                    <button type="button" onClick={addPractice}
                      className="text-xs font-sans text-amber hover:underline">
                      + Добавить практику
                    </button>
                  )}
                </div>
                {practices.length === 0 ? (
                  <div className="bg-surface-warm border border-border rounded-md px-3 py-2 text-xs font-sans text-ink-tertiary">
                    Нажмите «Добавить практику», чтобы приложить программы практик.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {practices.map((p, i) => (
                      <PracticeRow
                        key={i}
                        row={p}
                        // Disable already-used types on subsequent rows so
                        // each of the 4 constants can appear at most once —
                        // matches how КНИТУ's official set is structured.
                        excludeTypes={practices.filter((_, idx) => idx !== i && practices[idx].type).map((r) => r.type as ProgramPracticeType)}
                        onPickFile={(file) => updatePractice(i, { file })}
                        onPickType={(type) => updatePractice(i, { type })}
                        onRemove={() => removePractice(i)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button onClick={submit} loading={importMut.isPending}>Импортировать и перейти</Button>
                <span className="text-xs font-sans text-ink-tertiary">
                  Извлечение и разбор документов могут занять 1–2 минуты
                </span>
              </div>
            </div>
        </div>
        )}

        {/* List */}
        {programs.length === 0 ? (
          <div className="max-w-lg mx-auto py-12 text-center">
            {canImport ? (
              <p className="text-sm font-sans text-ink-secondary">
                Пока нет учебных планов. Импортируйте первую программу, чтобы проанализировать её архитектуру.
              </p>
            ) : readOnly ? (
              <p className="text-sm font-sans text-ink-secondary">
                В организации пока нет образовательных программ. Когда РОП импортирует первую программу, она появится здесь.
              </p>
            ) : (
              <p className="text-sm font-sans text-ink-secondary">
                Нет программ, доступных вам для просмотра.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="font-display text-lg font-bold text-ink">
                {readOnly ? 'Программы организации' : 'Ваши программы'}
              </h2>
              <span className="text-sm font-sans text-ink-tertiary">· {programs.length}</span>
            </div>
            <ProgramList programs={programs} onOpen={(id) => navigate(`/programs/${id}`)} />
          </>
        )}
      </div>
    </div>
  )
}

// Small inline glyphs for the header CTA (SVG, not emoji — design system).
const PlusGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
)
const CloseGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="M6 6l12 12" />
  </svg>
)

// Groups programmes by направление (org_unit_id, falling back to code+specialty_name
// for programmes not yet linked to the tree). A направление with a single profile
// renders as a compact card; multi-profile направления get a header + nested list
// so the user can see the whole set at a glance without navigating in and out.
// The profile field on each programme is what distinguishes rows within a group
// — see the intake form's «профиль» field which is where this text comes from.
function ProgramList({
  programs, onOpen,
}: {
  programs: Program[]
  onOpen: (id: string) => void
}) {
  interface Group { key: string; heading: { code: string | null; name: string }; items: Program[] }
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  for (const p of programs) {
    const key = p.org_unit_id ?? `unlinked:${(p.code ?? '').trim()}::${(p.specialty_name ?? p.name).trim()}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, heading: { code: p.code ?? null, name: p.specialty_name || p.name }, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(p)
  }
  // Sort groups by heading name; sort items within a group by profile then updated_at.
  groups.sort((a, b) => a.heading.name.localeCompare(b.heading.name, 'ru'))
  for (const g of groups) {
    g.items.sort((a, b) =>
      (a.profile ?? '').localeCompare(b.profile ?? '', 'ru') ||
      b.updated_at.localeCompare(a.updated_at)
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        g.items.length === 1
          ? <ProgramCard key={g.key} p={g.items[0]} onOpen={onOpen} showDirection />
          : (
            <div key={g.key}>
              <div className="flex items-baseline gap-2 mb-1.5 px-1">
                {g.heading.code && (
                  <span className="text-xs font-mono font-medium text-ink-secondary">{g.heading.code}</span>
                )}
                <span className="text-xs font-sans font-semibold text-ink-secondary uppercase tracking-wider">{g.heading.name}</span>
                <span className="text-[11px] font-sans text-ink-tertiary">· {g.items.length} профил{profileWord(g.items.length)}</span>
              </div>
              <div className="space-y-1.5">
                {g.items.map((p) => (
                  <ProgramCard key={p.id} p={p} onOpen={onOpen} showDirection={false} />
                ))}
              </div>
            </div>
          )
      ))}
    </div>
  )
}

function profileWord(n: number): string {
  // 1 профиль, 2-4 профиля, 5+ профилей
  const mod10 = n % 10, mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'ей'
  if (mod10 === 1) return 'ь'
  if (mod10 >= 2 && mod10 <= 4) return 'я'
  return 'ей'
}

function ProgramCard({ p, onOpen, showDirection }: { p: Program; onOpen: (id: string) => void; showDirection: boolean }) {
  // Title: the profile when we're inside a grouped направление (siblings share
  // the heading), otherwise the направление name (single-profile case, keeps
  // the flat look the list has always had).
  const title = showDirection ? (p.specialty_name || p.name) : (p.profile || p.name || 'Профиль без названия')
  return (
    <button
      onClick={() => onOpen(p.id)}
      className="w-full text-left bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-mid hover:bg-surface-warm transition-colors flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-sans font-medium text-ink truncate">{title}</div>
        <div className="text-xs font-sans text-ink-tertiary mt-0.5">
          {showDirection && p.code && <span>{p.code} · </span>}
          {showDirection && p.profile && <span>{p.profile} · </span>}
          {p.education_level
            ? <span>{p.education_level} · </span>
            : p.level ? <span>{LEVEL_LABEL[p.level]} · </span> : null}
          {p.duration_semesters} сем. · обновлён {fmt(p.updated_at)}
        </div>
      </div>
      <span className="text-ink-tertiary text-sm flex-shrink-0">→</span>
    </button>
  )
}

function Field({ label, value, onChange, placeholder, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">{label}</span>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full text-sm bg-surface border border-border rounded-md px-3 py-2 focus:border-border-strong outline-none ${mono ? 'font-mono' : 'font-sans'}`}
      />
    </label>
  )
}

function FileField({ label, file, onPick, inputRef, required = false, url, onPickUrl }: {
  label: string; file: File | null; onPick: (f: File | null) => void
  inputRef: React.RefObject<HTMLInputElement>; required?: boolean
  // When provided, the field also offers "or paste a link"; a field holds a
  // file OR a url, never both (the parent clears the other on set).
  url?: string | null; onPickUrl?: (url: string | null) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  // Quietly reject non-PDFs dropped onto the zone. The file picker uses
  // `accept="application/pdf"` so it already filters; the drop path needs
  // its own gate. We use an extension check as a fallback because some
  // PDF clients leave `file.type` blank.
  function isPdf(f: File): boolean {
    return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && isPdf(f)) onPick(f)
  }

  return (
    <div>
      <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">{label}</span>
      <input
        ref={inputRef} type="file" accept="application/pdf" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />

      {file ? (
        // Selected — compact pill with replace + clear controls.
        <div className="flex items-center gap-2 border border-amber/40 bg-amber-light/40 rounded-md px-3 py-2">
          <span className="text-base leading-none">📄</span>
          <span className="text-sm font-sans text-ink truncate flex-1">{file.name}</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[11px] font-sans text-ink-secondary hover:text-amber transition-colors flex-shrink-0"
          >
            Заменить
          </button>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-ink-tertiary hover:text-danger transition-colors text-lg leading-none flex-shrink-0"
            aria-label="Убрать файл"
          >
            ×
          </button>
        </div>
      ) : url ? (
        // A link was pasted instead of a file — the server will fetch it.
        <div className="flex items-center gap-2 border border-amber/40 bg-amber-light/40 rounded-md px-3 py-2">
          <span className="text-base leading-none">🔗</span>
          <span className="text-sm font-sans text-ink truncate flex-1" title={url}>{url}</span>
          <button
            type="button"
            onClick={() => onPickUrl?.(null)}
            className="text-ink-tertiary hover:text-danger transition-colors text-lg leading-none flex-shrink-0"
            aria-label="Убрать ссылку"
          >
            ×
          </button>
        </div>
      ) : (
        // Idle — proper drop zone matching the grading uploader's vocabulary.
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-md border-2 border-dashed cursor-pointer transition-colors text-center
            ${dragOver
              ? 'border-amber bg-amber-light'
              : 'border-amber/40 bg-amber-light/40 hover:border-amber/70 hover:bg-amber-light/70'}`}
        >
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-amber text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="M6 10l6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </span>
          <span className="text-xs font-sans text-ink">
            Перетащите PDF или{' '}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-amber text-white font-medium">
              выберите
            </span>
          </span>
          <span className="text-[11px] font-sans text-ink-tertiary">
            PDF{required ? ' · обязательно' : ' · необязательно'}
          </span>
        </div>
      )}
      {onPickUrl && !file && !url && (
        <div className="mt-1.5">
          <UrlUploadField onSubmit={(u) => onPickUrl(u)} />
        </div>
      )}
    </div>
  )
}

// One row of the practices multi-file — type dropdown + file picker + remove.
// `excludeTypes` disables types already used by sibling rows so each of the
// four PROGRAM_PRACTICE_TYPES can appear at most once in the intake.
function PracticeRow({
  row, excludeTypes, onPickType, onPickFile, onRemove,
}: {
  row:          { file: File | null; type: ProgramPracticeType | '' }
  excludeTypes: ProgramPracticeType[]
  onPickType:   (t: ProgramPracticeType | '') => void
  onPickFile:   (f: File | null) => void
  onRemove:     () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectCls =
    'text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-border-strong flex-1 min-w-0'

  return (
    <div className="bg-surface-warm border border-border rounded-md px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={row.type}
          onChange={(e) => onPickType(e.target.value as ProgramPracticeType | '')}
          className={selectCls}
        >
          <option value="" disabled>Выберите тип практики</option>
          {PROGRAM_PRACTICE_TYPES.map((t) => (
            <option key={t} value={t} disabled={excludeTypes.includes(t) && row.type !== t}>
              {PROGRAM_PRACTICE_LABEL[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="text-ink-tertiary hover:text-danger transition-colors leading-none w-6 h-6 text-lg flex items-center justify-center flex-shrink-0"
          aria-label="Убрать практику"
        >
          ×
        </button>
      </div>
      <input
        ref={inputRef} type="file" accept="application/pdf" className="hidden"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />
      {row.file ? (
        <div className="flex items-center gap-2 border border-amber/40 bg-amber-light/40 rounded-md px-3 py-1.5">
          <span className="text-base leading-none">📄</span>
          <span className="text-sm font-sans text-ink truncate flex-1">{row.file.name}</span>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="text-[11px] font-sans text-ink-secondary hover:text-amber transition-colors flex-shrink-0">
            Заменить
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="w-full text-left text-xs font-sans text-ink-secondary hover:text-amber bg-surface border border-dashed border-border rounded-md px-3 py-2 transition-colors">
          Выберите PDF для этой практики
        </button>
      )}
    </div>
  )
}
