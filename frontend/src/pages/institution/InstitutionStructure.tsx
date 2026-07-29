import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getOrgStructure, createOrgUnit, bulkCreateOrgUnits, updateOrgUnit, deleteOrgUnit,
  retypeOrgUnit, moveOrgUnit,
  getMembers, setPrimaryUnit, grantRole, revokeRole, DOMAIN_LABEL,
  type OrgUnit, type OrgUnitType, type OrgUnitMeta, type InstitutionMember, type UnitRole, type GrantDomain,
} from '../../api/orgStructure'
import { EDUCATION_LEVELS, STUDY_FORMS } from '../../types'
import { buildTree, TYPE_LABEL, type TreeNode } from '../../lib/orgTree'

const ROLE_LABEL: Record<UnitRole, string> = {
  admin: 'Администратор',
  edit:  'Редактор',
  view:  'Наблюдатель',
}

// Research.md §7.10 — domains a grant can be scoped to. 'admin' is always
// full-scope (enforced server-side), so the domain picker only offers a
// meaningful choice for 'edit'/'view'. 'teaching' added Phase 2, 'umu' with
// the access matrix (docs/ACCESS-MATRIX.md).
const GRANT_DOMAIN_OPTIONS: GrantDomain[] = ['all', 'curriculum', 'teaching', 'umu']

// Level accenting. Two colour families, each reserved for one meaning: amber
// is the brand/action accent (Button.tsx's `primary` variant, the CTA pulse,
// tab-active indicators) — reserved here for the chain that leads to a real
// programme anchor, rising in intensity (light fill → full fill) as you reach
// `program`, the actual leaf a РОП links against. `info` (indigo — already
// used elsewhere for informational badges, see ui/Badge.tsx) marks УГСН: a
// real classification level with its own code, but never a РОП anchor and
// never actionable — informational, not actionable, so it doesn't borrow the
// action colour. Everything else (root/management/grouping/department) stays
// on the neutral ink/surface scale, tone-graded from darkest (root,
// authoritative) to quietest (kafedra). Every tier also keeps its own label
// text, so nothing is conveyed by colour alone.
type UnitTier = 'root' | 'management' | 'grouping' | 'ugsn' | 'direction' | 'program' | 'department'
const TYPE_TIER: Record<OrgUnitType, UnitTier> = {
  institution:       'root',
  governance:        'management',
  admin_office:      'management',
  cluster:           'grouping',
  division:          'grouping',
  ugsn:              'ugsn',
  program_direction: 'direction',
  program:           'program',
  department:        'department',
}
// Badge fill per tier (label chip on each row).
const TIER_BADGE: Record<UnitTier, string> = {
  root:       'bg-sidebar text-ink-inverse border-transparent',
  management: 'bg-ink/5 text-ink-secondary border-border-mid',
  grouping:   'bg-surface-warm text-ink-secondary border-border-mid',
  ugsn:       'bg-info-bg text-info border-info/20',
  direction:  'bg-amber-light/70 text-amber border-amber/20',
  program:    'bg-amber-light text-amber border-amber/35',
  department: 'bg-surface text-ink-tertiary border-border',
}
// Left spine on the row card — a quiet per-level colour cue you can scan down;
// the amber steps (direction → program) intensify together with the badge
// fill above, so the two cues read as one system. ugsn's info spine is a
// deliberate colour *change*, not another step in the amber ramp — it marks
// "you've reached the informational classification level," distinct from
// "you've reached something actionable."
const TIER_SPINE: Record<UnitTier, string> = {
  root:       'border-l-ink',
  management: 'border-l-ink-tertiary',
  grouping:   'border-l-border-mid',
  ugsn:       'border-l-info/40',
  direction:  'border-l-amber/55',
  program:    'border-l-amber',
  department: 'border-l-border',
}

// Unit types whose head/admin grant confers institution-WIDE authority
// (services/programAccess.ts: governance / admin_office → all-rw over every
// programme). Warn the admin so they don't hand out institution-wide access
// thinking it's scoped to a small office.
const INSTITUTION_WIDE_TYPES = new Set<OrgUnitType>(['governance', 'admin_office'])

// Warn about the authorisation blast radius of a grant before it's applied.
// Returns null when the grant is ordinary (scoped to the unit's subtree).
// 2026-07-29 — 'admin' no longer auto-forces domain='all' (that WAS the trap:
// every admin grant became institution-wide regardless of which unit it sat
// on — see routes/orgUnits.ts's POST /roles). 'admin' now scopes exactly
// like 'edit'/'view' do: to the granted unit's own subtree, in whichever
// domain is picked. domain='all' still means "every axis" — genuinely
// institution-wide only when the unit IS the institution root; the server
// rejects role='admin' + domain='all' anywhere else, and the form below
// disables «Назначить» for that combination instead of letting it round-trip
// to a server error.
function grantWarning(unit: OrgUnit | undefined, role: UnitRole, domain: GrantDomain): string | null {
  if (!unit) return null
  if (role === 'admin' && domain === 'all' && unit.type_code === 'institution') {
    return 'Даёт полный доступ администратора ко всей организации (равнозначно администратору организации).'
  }
  if ((role === 'admin' || role === 'edit') && (domain === 'all' || domain === 'curriculum') && INSTITUTION_WIDE_TYPES.has(unit.type_code)) {
    // Unrelated to the domain='all' expansion above — services/programAccess.ts
    // hardcodes governance/admin_office head/admin → all-rw programme access,
    // but only reads domain IN ('all', 'curriculum') grants (its own query),
    // so a 'teaching'/'platform'/'umu'-only grant here doesn't trigger it.
    return 'Подразделения этого типа дают доступ ко всем образовательным программам организации, а не только к этому подразделению.'
  }
  if (role === 'admin' && domain === 'all' && unit.type_code !== 'institution') {
    return '«Администратор» с областью «Все» доступен только на уровне всей организации — выберите конкретную область ниже, чтобы ограничить роль этим подразделением.'
  }
  return null
}

// Short label for a unit in chips / selects — short_name when present.
const unitLabel = (u?: OrgUnit) => (u ? (u.short_name || u.name) : '—')

// Order offered in the "add child" picker — institution excluded (roots are not
// created here). Flexible depth: any of these may nest under any parent (§7.1).
const CREATABLE: Exclude<OrgUnitType, 'institution'>[] =
  ['governance', 'admin_office', 'cluster', 'division', 'ugsn', 'program_direction', 'program', 'department']

// Default-collapsed types — at the институт level and below, kafedra lists get
// long fast. Management chain (root / governance / admin_office / cluster)
// stays open so the overall shape of the org is always visible.
const DEFAULT_COLLAPSED_TYPES = new Set<OrgUnitType>(['division', 'ugsn', 'program_direction', 'program', 'department'])
const EXPANDED_STORAGE_KEY = 'ga_org_expanded_v1'

// Programme-anchor types carry the ФГОС header the РОП import form prefills.
const PROGRAMME_TYPES = new Set<OrgUnitType>(['program', 'program_direction'])

// Editable shape of the four metadata fields (all strings in the form; empty →
// null on the wire). formsOfStudy is the STUDY_FORMS labels joined with ', '.
interface MetaForm { code: string; specialtyName: string; educationLevel: string; formsOfStudy: string }

const emptyMeta: MetaForm = { code: '', specialtyName: '', educationLevel: '', formsOfStudy: '' }

const metaFromUnit = (u: OrgUnit): MetaForm => ({
  code:           u.code ?? '',
  specialtyName:  u.specialty_name ?? '',
  educationLevel: u.education_level ?? '',
  formsOfStudy:   u.forms_of_study ?? '',
})

const metaToPayload = (m: MetaForm): OrgUnitMeta => ({
  code:           m.code.trim() || null,
  specialtyName:  m.specialtyName.trim() || null,
  educationLevel: m.educationLevel.trim() || null,
  formsOfStudy:   m.formsOfStudy.trim() || null,
})

// Shared editor for the four programme-metadata fields. Уровень образования and
// формы обучения are national closed sets, so they render as a dropdown /
// checkboxes rather than free text (that's the whole point — the РОП later
// picks the unit and these prefill, no retyping).
function ProgrammeMetaFields({ value, onChange }: { value: MetaForm; onChange: (m: MetaForm) => void }) {
  const inputCls =
    'w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong'
  const selectedForms = new Set(value.formsOfStudy.split(',').map((s) => s.trim()).filter(Boolean))
  const toggleForm = (f: string) => {
    const next = new Set(selectedForms)
    if (next.has(f)) next.delete(f); else next.add(f)
    onChange({ ...value, formsOfStudy: STUDY_FORMS.filter((x) => next.has(x)).join(', ') })
  }
  return (
    <div className="space-y-2 bg-amber-light/40 border border-amber/15 rounded-md px-3 py-2.5">
      <div className="text-[11px] font-sans font-semibold text-ink-secondary uppercase tracking-wider">
        Данные программы (ФГОС) — подставятся в форму импорта у РОП
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="block w-28">
          <span className="text-[11px] font-sans text-ink-secondary block mb-1">Код</span>
          <input value={value.code} onChange={(e) => onChange({ ...value, code: e.target.value })}
            placeholder="09.03.01" className={`${inputCls} font-mono`} />
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="text-[11px] font-sans text-ink-secondary block mb-1">Наименование направления / специальности</span>
          <input value={value.specialtyName} onChange={(e) => onChange({ ...value, specialtyName: e.target.value })}
            placeholder="Информатика и вычислительная техника" className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className="text-[11px] font-sans text-ink-secondary block mb-1">Уровень образования</span>
        <select value={value.educationLevel} onChange={(e) => onChange({ ...value, educationLevel: e.target.value })}
          className={inputCls}>
          <option value="">— не указан —</option>
          {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <div>
        <span className="text-[11px] font-sans text-ink-secondary block mb-1">Формы обучения</span>
        <div className="flex flex-wrap gap-3">
          {STUDY_FORMS.map((f) => (
            <label key={f} className="inline-flex items-center gap-1.5 text-sm font-sans text-ink cursor-pointer">
              <input type="checkbox" checked={selectedForms.has(f)} onChange={() => toggleForm(f)} className="accent-amber" />
              {f}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function InstitutionStructure() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data: units = [], isLoading } = useQuery({ queryKey: ['org-structure'], queryFn: getOrgStructure })
  const tree = useMemo(() => buildTree(units), [units])

  const [addingUnder, setAddingUnder] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [managing, setManaging] = useState<string | null>(null)

  // Expand/collapse state. Init from localStorage on first units-load; new
  // units (added after init) fall through to the type-default rule via
  // `isDefaultExpanded`. Persisted whenever the user toggles.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const initialised = useRef(false)
  useEffect(() => {
    if (initialised.current || units.length === 0) return
    initialised.current = true
    try {
      const saved = localStorage.getItem(EXPANDED_STORAGE_KEY)
      if (saved) {
        setExpanded(new Set(JSON.parse(saved) as string[]))
        return
      }
    } catch { /* fall through to defaults */ }
    setExpanded(new Set(units.filter((u) => !DEFAULT_COLLAPSED_TYPES.has(u.type_code)).map((u) => u.id)))
  }, [units])
  useEffect(() => {
    if (!initialised.current) return
    try { localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expanded])) } catch { /* quota — ignore */ }
  }, [expanded])

  // For nodes the page hasn't seen before (e.g. just added), fall back to the
  // type-default rule rather than treating "not in set" as "collapsed".
  const isExpanded = (u: OrgUnit): boolean =>
    expanded.has(u.id) || (!initialised.current && !DEFAULT_COLLAPSED_TYPES.has(u.type_code))

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Opening the «+» on a node should also expand it — otherwise the newly
  // created child wouldn't be visible after the mutation resolves.
  const openAddUnder = (id: string) => {
    setAddingUnder((cur) => (cur === id ? null : id))
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  // Header toggle — flips between "expand everything" and "collapse everything
  // except roots". Roots stay expanded on collapse-all so the page never
  // renders as a single closed strip.
  const anyExpanded = units.some((u) => u.parent_id && expanded.has(u.id))
  const expandAll   = () => setExpanded(new Set(units.map((u) => u.id)))
  const collapseAll = () => setExpanded(new Set(units.filter((u) => !u.parent_id).map((u) => u.id)))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-structure'] })

  const createMut = useMutation({
    mutationFn: createOrgUnit,
    onSuccess: () => { invalidate(); setAddingUnder(null); addToast('Подразделение создано', 'success') },
  })
  const bulkMut = useMutation({
    mutationFn: bulkCreateOrgUnits,
    onSuccess: (created) => {
      invalidate(); setAddingUnder(null)
      addToast(`Добавлено подразделений: ${created.length}`, 'success')
    },
  })
  const updateMut = useMutation({
    mutationFn: (v: { id: string; name: string }) => updateOrgUnit(v.id, { name: v.name }),
    onSuccess: () => { invalidate(); setEditing(null); addToast('Сохранено', 'success') },
  })
  const deleteMut = useMutation({
    mutationFn: deleteOrgUnit,
    onSuccess: () => { invalidate(); addToast('Подразделение удалено', 'success') },
    onError: (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось удалить', 'error'),
  })
  const retypeMut = useMutation({
    mutationFn: (v: { id: string; typeCode: Exclude<OrgUnitType, 'institution'> }) => retypeOrgUnit(v.id, v.typeCode),
    onSuccess: () => { invalidate(); setManaging(null); addToast('Тип изменён', 'success') },
    onError: (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось изменить тип', 'error'),
  })
  const moveMut = useMutation({
    mutationFn: (v: { id: string; newParentId: string }) => moveOrgUnit(v.id, v.newParentId),
    onSuccess: () => { invalidate(); setManaging(null); addToast('Подразделение перемещено', 'success') },
    onError: (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось переместить', 'error'),
  })
  const metaMut = useMutation({
    mutationFn: (v: { id: string; meta: OrgUnitMeta }) => updateOrgUnit(v.id, v.meta),
    onSuccess: () => { invalidate(); addToast('Данные программы сохранены', 'success') },
    onError: (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось сохранить', 'error'),
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Структура организации</h1>
          <p className="text-sm font-sans text-ink-secondary mt-1">
            Дерево подразделений — управления, институты, кафедры. Роли и доступ назначаются по дереву.
          </p>
        </div>

        <FeatureIntro
          id="org-structure"
          title="Как это работает"
          description="Постройте дерево вашей организации: от управлений и центров до институтов и кафедр. Глубину выбираете сами — пропускайте уровни, которых у вас нет. Преподаватели привязываются к кафедрам, а права администраторов и руководителей распространяются вниз по дереву."
          steps={[
            'Добавляйте подразделения внутри корневой организации',
            'Вкладывайте институты и кафедры на нужную глубину',
            'Далее — назначение преподавателей и ролей по подразделениям',
          ]}
        />

        {isLoading ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">Загрузка…</div>
        ) : tree.length === 0 ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">
            Корневое подразделение не найдено. Обратитесь в поддержку платформы.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={anyExpanded ? collapseAll : expandAll}
                className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors px-2 py-1"
              >
                {anyExpanded ? 'Свернуть всё' : 'Развернуть всё'}
              </button>
            </div>
            <div className="space-y-1">
              {tree.map((node) => (
                <UnitRow
                  key={node.id} node={node} depth={0} allUnits={units}
                  addingUnder={addingUnder} openAddUnder={openAddUnder}
                  editing={editing} setEditing={setEditing}
                  managing={managing} setManaging={setManaging}
                  isExpanded={isExpanded} toggleExpanded={toggleExpanded}
                  createMut={createMut} bulkMut={bulkMut} updateMut={updateMut} deleteMut={deleteMut}
                  retypeMut={retypeMut} moveMut={moveMut} metaMut={metaMut}
                />
              ))}
            </div>
          </>
        )}

        {units.length > 0 && <MembersSection units={units} />}
      </div>
    </div>
  )
}

// ─── Members & roles ──────────────────────────────────────────────────────────

function MembersSection({ units }: { units: OrgUnit[] }) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data: members = [] } = useQuery({ queryKey: ['org-members'], queryFn: getMembers })
  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const departments = useMemo(() => units.filter((u) => u.type_code === 'department'), [units])

  // ── Search / quick-filter / pagination — the roster can run to hundreds ──
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'with_roles' | 'no_roles' | 'no_kafedra'>('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const counts = useMemo(() => ({
    all:        members.length,
    with_roles: members.filter((m) => m.roles.length > 0).length,
    no_roles:   members.filter((m) => m.roles.length === 0).length,
    no_kafedra: members.filter((m) => !m.primary_org_unit_id).length,
  }), [members])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) => {
      if (q && !((m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q))) return false
      if (filter === 'with_roles' && m.roles.length === 0) return false
      if (filter === 'no_roles'   && m.roles.length > 0)   return false
      if (filter === 'no_kafedra' && m.primary_org_unit_id) return false
      return true
    })
  }, [members, search, filter])

  useEffect(() => { setPage(1) }, [search, filter])   // any filter change → back to page 1
  const pageCount   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageItems   = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-members'] })
  const onError = (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось сохранить', 'error')

  const primaryMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string }) => setPrimaryUnit(v.teacherId, v.unitId),
    onSuccess: () => { invalidate(); addToast('Кафедра обновлена', 'success') }, onError,
  })
  const grantMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string; role: UnitRole; domain: GrantDomain }) =>
      grantRole(v.teacherId, v.unitId, v.role, v.domain),
    onSuccess: () => { invalidate(); addToast('Роль назначена', 'success') }, onError,
  })
  const revokeMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string; role: UnitRole; domain: GrantDomain }) =>
      revokeRole(v.teacherId, v.unitId, v.role, v.domain),
    onSuccess: () => { invalidate(); addToast('Роль снята', 'success') }, onError,
  })

  return (
    <div className="mt-10">
      <h2 className="font-display text-lg font-bold text-ink mb-1">Преподаватели и роли</h2>
      <p className="text-sm font-sans text-ink-secondary mb-4">
        Привяжите преподавателей к кафедрам и назначьте роли по подразделениям. Права распространяются вниз по дереву.
      </p>

      {members.length === 0 ? (
        <div className="text-center py-10 text-sm font-sans text-ink-secondary">
          В организации пока нет преподавателей.
        </div>
      ) : (
        <>
          {/* Controls stick to the top of the scroll area so search + filters */}
          {/* stay reachable however far down the roster you scroll. */}
          <div className="sticky top-0 z-10 bg-bg pt-1 pb-3 mb-1 border-b border-border">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none"><SearchIcon /></span>
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени или почте"
                  aria-label="Поиск преподавателя"
                  className="w-full text-sm font-sans bg-surface border border-border rounded-md pl-8 pr-2.5 py-2 outline-none focus:border-border-strong"
                />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {([
                  ['all', 'Все'], ['with_roles', 'С ролями'],
                  ['no_roles', 'Без ролей'], ['no_kafedra', 'Без кафедры'],
                ] as [typeof filter, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setFilter(key)}
                    className={`text-xs font-sans px-2.5 py-1.5 rounded-md border transition-colors ${
                      filter === key
                        ? 'bg-amber-light text-amber border-amber/25 font-medium'
                        : 'bg-surface text-ink-secondary border-border hover:bg-surface-warm'
                    }`}>
                    {label} <span className={filter === key ? 'text-amber/70' : 'text-ink-tertiary'}>{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] font-sans text-ink-tertiary mt-2">
              {filtered.length === members.length
                ? `${members.length} ${plural(members.length, 'преподаватель', 'преподавателя', 'преподавателей')}`
                : `Найдено: ${filtered.length} из ${members.length}`}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-10 text-sm font-sans text-ink-secondary">
              Никого не нашли. Измените запрос или фильтр.
            </div>
          ) : (
            <div className="space-y-2">
              {pageItems.map((m) => (
                <MemberRow
                  key={m.id} member={m} departments={departments} units={units} unitsById={unitsById}
                  onSetPrimary={(unitId) => primaryMut.mutate({ teacherId: m.id, unitId })}
                  onGrant={(unitId, role, domain) => grantMut.mutate({ teacherId: m.id, unitId, role, domain })}
                  onRevoke={(unitId, role, domain) => revokeMut.mutate({ teacherId: m.id, unitId, role, domain })}
                />
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button disabled={clampedPage <= 1} onClick={() => setPage(clampedPage - 1)}
                className="text-sm font-sans px-3 py-1.5 rounded-md border border-border-mid text-ink-secondary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-warm transition-colors">
                ← Назад
              </button>
              <span className="text-xs font-sans text-ink-tertiary">Стр. {clampedPage} из {pageCount}</span>
              <button disabled={clampedPage >= pageCount} onClick={() => setPage(clampedPage + 1)}
                className="text-sm font-sans px-3 py-1.5 rounded-md border border-border-mid text-ink-secondary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-warm transition-colors">
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Russian plural helper (1 преподаватель / 2 преподавателя / 5 преподавателей).
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

function MemberRow({ member, departments, units, unitsById, onSetPrimary, onGrant, onRevoke }: {
  member: InstitutionMember
  departments: OrgUnit[]
  units: OrgUnit[]
  unitsById: Map<string, OrgUnit>
  onSetPrimary: (unitId: string) => void
  onGrant: (unitId: string, role: UnitRole, domain: GrantDomain) => void
  onRevoke: (unitId: string, role: UnitRole, domain: GrantDomain) => void
}) {
  const [adding, setAdding] = useState(false)
  const [roleUnit, setRoleUnit] = useState(units[0]?.id ?? '')
  const [role, setRole] = useState<UnitRole>('edit')
  const [domain, setDomain] = useState<GrantDomain>('all')

  const selectCls =
    'text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none ' +
    'focus:border-border-strong text-ellipsis cursor-pointer'

  // Blast-radius hint: roles cascade down the tree, so holding a role on a unit
  // AND on one of its descendants means the ancestor grant already covers the
  // descendant — the nested grant is redundant, and (the real risk) the
  // ancestor grant is broader than the admin may realise. Surface the pairs so
  // an over-wide leftover (e.g. a polygroup grant left on when only one
  // programme was intended) is obvious. `redundantUnitIds` marks the covered
  // (descendant) chips; `overlaps` drives the explanatory line.
  // Domain-aware (§7.10): the ancestor only covers the descendant when their
  // domains actually overlap — a domain='curriculum' grant is not made
  // redundant by an unrelated domain='platform' grant on an ancestor, only
  // by an ancestor grant that is domain='all' or the same domain.
  const { overlaps, redundantUnitIds } = useMemo(() => {
    const seen = new Set<string>()
    const pairs: { broad: OrgUnit; narrow: OrgUnit }[] = []
    const redundant = new Set<string>()
    for (const a of member.roles) {
      for (const b of member.roles) {
        if (a.org_unit_id === b.org_unit_id) continue
        if (a.domain !== 'all' && a.domain !== b.domain) continue
        const ua = unitsById.get(a.org_unit_id)
        const ub = unitsById.get(b.org_unit_id)
        if (!ua || !ub) continue
        // ua is a strict ancestor of ub when ua's path is a prefix of ub's.
        if (ub.path !== ua.path && ub.path.startsWith(ua.path)) {
          redundant.add(ub.id)
          const key = `${ua.id}->${ub.id}`
          if (!seen.has(key)) { seen.add(key); pairs.push({ broad: ua, narrow: ub }) }
        }
      }
    }
    return { overlaps: pairs, redundantUnitIds: redundant }
  }, [member.roles, unitsById])

  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3 space-y-2.5">
      {/* Identity · kafedra · roles */}
      <div className="flex items-start gap-x-4 gap-y-2.5 flex-wrap">
        <div className="min-w-[160px] flex-shrink-0">
          <div className="text-sm font-sans font-medium text-ink truncate max-w-[220px]">{member.name || member.email}</div>
          {member.name && <div className="text-xs font-sans text-ink-tertiary truncate max-w-[220px]">{member.email}</div>}
        </div>

        <label className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-sans text-ink-secondary">Кафедра:</span>
          <select
            value={member.primary_org_unit_id ?? ''}
            onChange={(e) => e.target.value && onSetPrimary(e.target.value)}
            className={`${selectCls} w-[240px]`}
            title={unitsById.get(member.primary_org_unit_id ?? '')?.name ?? 'Не назначена'}
          >
            <option value="" disabled>Не назначена</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>

        <div className="flex-1 min-w-[180px] flex flex-wrap items-center gap-1.5 justify-end">
          {member.roles.map((r) => {
            const isRedundant = redundantUnitIds.has(r.org_unit_id)
            const roleLabel = r.domain === 'all' ? ROLE_LABEL[r.role] : `${ROLE_LABEL[r.role]} (${DOMAIN_LABEL[r.domain]})`
            const full = isRedundant
              ? `${roleLabel} · ${unitsById.get(r.org_unit_id)?.name ?? ''} — избыточно: более широкая роль уже покрывает это подразделение`
              : `${roleLabel} · ${unitsById.get(r.org_unit_id)?.name ?? ''}`
            return (
              <span key={`${r.org_unit_id}-${r.role}-${r.domain}`} title={full}
                className={`inline-flex items-center gap-1 max-w-[240px] text-xs font-sans rounded-sm pl-2 pr-1 py-0.5 border ${
                  isRedundant
                    ? 'bg-surface-warm text-ink-tertiary border-border-mid border-dashed'
                    : 'bg-amber-light text-amber border-amber/20'
                }`}>
                <span className="truncate">{roleLabel} · {unitLabel(unitsById.get(r.org_unit_id))}</span>
                <button onClick={() => onRevoke(r.org_unit_id, r.role, r.domain)} aria-label="Снять роль"
                  className={`transition-colors leading-none flex-shrink-0 ${isRedundant ? 'text-ink-tertiary hover:text-danger' : 'text-amber/60 hover:text-danger'}`}>×</button>
              </span>
            )
          })}
          {member.roles.length === 0 && <span className="text-xs font-sans text-ink-tertiary">Ролей нет</span>}
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors px-2 py-1 border border-border-mid rounded-md flex-shrink-0">
              + роль
            </button>
          )}
        </div>
      </div>

      {/* Overlapping-grant hint — a role on a unit already covers any role on */}
      {/* its descendants, so the nested one is redundant (and the ancestor is */}
      {/* broader than it may look). */}
      {overlaps.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] font-sans text-warning bg-warning-bg border border-warning/15 rounded-md px-2.5 py-1.5">
          <span className="flex-shrink-0 mt-px text-warning"><WarnIcon /></span>
          <span className="leading-relaxed">
            {overlaps.length === 1 ? (
              <>Роль на «{unitLabel(overlaps[0].broad)}» уже распространяется на «{unitLabel(overlaps[0].narrow)}» — вложенная роль избыточна. Чтобы ограничить доступ, снимите более широкую роль.</>
            ) : (
              <>Роли вложены друг в друга: {overlaps.map((o) => `«${unitLabel(o.broad)}» → «${unitLabel(o.narrow)}»`).join('; ')}. Более широкая роль уже покрывает вложенную — снимите широкие роли, чтобы ограничить доступ.</>
            )}
          </span>
        </div>
      )}

      {/* Grant a role — own full-width line so long unit names have room */}
      {adding && (() => {
        const unit = unitsById.get(roleUnit)
        const warning = grantWarning(unit, role, domain)
        // «Администратор» + «Все» is only legal on the institution root
        // (routes/orgUnits.ts's POST /roles rejects it server-side too) —
        // block submission instead of letting it round-trip to an error.
        const blocked = role === 'admin' && domain === 'all' && unit?.type_code !== 'institution'
        return (
        <div className="pt-2.5 border-t border-border space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[240px]">
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">Подразделение</span>
              <select value={roleUnit} onChange={(e) => setRoleUnit(e.target.value)}
                className={`${selectCls} w-full`}
                title={unitsById.get(roleUnit)?.name ?? ''}>
                {units.map((u) => <option key={u.id} value={u.id}>{TYPE_LABEL[u.type_code]}: {u.name}</option>)}
              </select>
            </label>
            <label className="block w-[150px]">
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">Роль</span>
              <select value={role} onChange={(e) => setRole(e.target.value as UnitRole)}
                className={`${selectCls} w-full`}>
                {(['admin', 'edit', 'view'] as UnitRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label className="block w-[220px]">
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">Область</span>
              <select value={domain} onChange={(e) => setDomain(e.target.value as GrantDomain)}
                className={`${selectCls} w-full`}>
                {GRANT_DOMAIN_OPTIONS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
              </select>
            </label>
            <button onClick={() => { if (roleUnit && !blocked) { onGrant(roleUnit, role, domain); setAdding(false) } }}
              disabled={blocked}
              className="px-3 py-1.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40">
              Назначить
            </button>
            <button onClick={() => setAdding(false)}
              className="px-2 py-1.5 text-sm font-sans text-ink-secondary hover:text-ink transition-colors">
              Отмена
            </button>
          </div>
          {role === 'view' && domain === 'all' && (
            <p className="text-[11px] font-sans text-ink-tertiary">
              «Наблюдатель» по всем областям пока не открывает дашборды подразделения (только чтение критериев/рубрик, если выбрана область «Учебно-методическая работа»).
            </p>
          )}
          {warning && (
            <p className="text-[11px] font-sans text-warning bg-warning-bg border border-warning/15 rounded-md px-2.5 py-1.5">
              {warning}
            </p>
          )}
        </div>
        )
      })()}
    </div>
  )
}

function UnitRow({
  node, depth, allUnits, addingUnder, openAddUnder, editing, setEditing,
  managing, setManaging,
  isExpanded, toggleExpanded,
  createMut, bulkMut, updateMut, deleteMut, retypeMut, moveMut, metaMut,
}: {
  node: TreeNode; depth: number; allUnits: OrgUnit[]
  addingUnder: string | null; openAddUnder: (id: string) => void
  editing: string | null; setEditing: (v: string | null) => void
  managing: string | null; setManaging: (v: string | null) => void
  isExpanded: (u: OrgUnit) => boolean
  toggleExpanded: (id: string) => void
  createMut: ReturnType<typeof useMutation<any, any, any>>
  bulkMut:   ReturnType<typeof useMutation<any, any, any>>
  updateMut: ReturnType<typeof useMutation<any, any, any>>
  deleteMut: ReturnType<typeof useMutation<any, any, any>>
  retypeMut: ReturnType<typeof useMutation<any, any, any>>
  moveMut:   ReturnType<typeof useMutation<any, any, any>>
  metaMut:   ReturnType<typeof useMutation<any, any, any>>
}) {
  const isRoot = !node.parent_id
  const [editName, setEditName] = useState(node.name)
  const hasChildren = node.children.length > 0
  const expanded = isExpanded(node)
  const tier = TYPE_TIER[node.type_code]

  return (
    <div>
      {/* Row = depth guide rails + the card. The rails are vertical lines, one
          per ancestor level, that line up across sibling rows into a scannable
          tree. The card carries a per-level colour spine on its left edge. */}
      <div className="flex items-stretch">
        {depth > 0 && (
          <div className="flex flex-shrink-0" aria-hidden="true">
            {Array.from({ length: depth }).map((_, i) => (
              <span key={i} className="w-[22px] border-l border-border" />
            ))}
          </div>
        )}
        <div
          className={`flex-1 min-w-0 flex items-center gap-2.5 bg-surface border border-border border-l-2 ${TIER_SPINE[tier]} rounded-lg px-3 py-2.5 hover:bg-surface-warm transition-colors`}
        >
        {/* Chevron — only when there's something to expand. Placeholder keeps */}
        {/* type chips vertically aligned across rows. */}
        {hasChildren ? (
          <button
            onClick={() => toggleExpanded(node.id)}
            aria-label={expanded ? 'Свернуть' : 'Развернуть'}
            className="w-5 h-5 flex items-center justify-center rounded-sm text-ink-tertiary hover:text-ink hover:bg-surface-warm transition-colors flex-shrink-0"
          >
            <ChevronIcon open={expanded} />
          </button>
        ) : (
          <span className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        )}

        <span className={`text-[10px] font-sans font-semibold uppercase tracking-wider border rounded-sm px-1.5 py-0.5 flex-shrink-0 ${TIER_BADGE[tier]}`}>
          {TYPE_LABEL[node.type_code]}
        </span>

        {editing === node.id ? (
          <input
            autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && editName.trim().length >= 2) updateMut.mutate({ id: node.id, name: editName.trim() }) }}
            className="flex-1 text-sm font-sans bg-surface border border-border-strong rounded-md px-2 py-1 outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <span className="text-sm font-sans font-medium text-ink">{node.name}</span>
            {node.short_name && <span className="text-xs font-sans text-ink-tertiary ml-2">({node.short_name})</span>}
          </div>
        )}

        {hasChildren && !expanded && (
          <span className="text-[11px] font-sans text-ink-tertiary flex-shrink-0">
            {node.children.length} внутри
          </span>
        )}
        {node.member_count > 0 && (
          <span className="text-[11px] font-sans text-ink-tertiary flex-shrink-0">{node.member_count} чел.</span>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {editing === node.id ? (
            <>
              <IconBtn label="Сохранить" onClick={() => editName.trim().length >= 2 && updateMut.mutate({ id: node.id, name: editName.trim() })}><CheckIcon /></IconBtn>
              <IconBtn label="Отмена" onClick={() => { setEditing(null); setEditName(node.name) }}><XIcon /></IconBtn>
            </>
          ) : (
            <>
              <IconBtn label="Добавить подразделение" onClick={() => openAddUnder(node.id)}><PlusIcon /></IconBtn>
              {!isRoot && <IconBtn label="Переименовать" onClick={() => { setEditing(node.id); setEditName(node.name) }}><PencilIcon /></IconBtn>}
              {!isRoot && (
                <IconBtn label="Тип и размещение" onClick={() => setManaging(managing === node.id ? null : node.id)}><GearIcon /></IconBtn>
              )}
              {!isRoot && (
                <IconBtn
                  label="Удалить" danger
                  onClick={() => { if (confirm(`Удалить «${node.name}»?`)) deleteMut.mutate(node.id) }}
                ><TrashIcon /></IconBtn>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {managing === node.id && (
        <ManageUnitPanel
          node={node} depth={depth + 1} allUnits={allUnits}
          onRetype={(typeCode) => retypeMut.mutate({ id: node.id, typeCode })}
          onMove={(newParentId) => moveMut.mutate({ id: node.id, newParentId })}
          onSaveMeta={(meta) => metaMut.mutate({ id: node.id, meta })}
          pending={retypeMut.isPending || moveMut.isPending || metaMut.isPending}
          onClose={() => setManaging(null)}
        />
      )}

      {addingUnder === node.id && (
        <AddChildForm
          parentId={node.id} depth={depth + 1}
          onCancel={() => openAddUnder(node.id)}
          onSubmit={(input) => createMut.mutate(input)}
          onSubmitBulk={(input) => bulkMut.mutate(input)}
          pending={createMut.isPending || bulkMut.isPending}
        />
      )}

      {expanded && node.children.map((child) => (
        <UnitRow
          key={child.id} node={child} depth={depth + 1} allUnits={allUnits}
          addingUnder={addingUnder} openAddUnder={openAddUnder}
          editing={editing} setEditing={setEditing}
          managing={managing} setManaging={setManaging}
          isExpanded={isExpanded} toggleExpanded={toggleExpanded}
          createMut={createMut} bulkMut={bulkMut} updateMut={updateMut} deleteMut={deleteMut}
          retypeMut={retypeMut} moveMut={moveMut} metaMut={metaMut}
        />
      ))}
    </div>
  )
}

// Parse the bulk-add textarea. One unit per line; "Название | Сокращение"
// (pipe-separated; short optional). Empty lines and duplicates within the batch
// are dropped silently — the backend also validates and the duplicate check
// there returns a clearer error if two non-empty lines collide on name.
function parseBulkUnits(text: string): { name: string; shortName: string | null }[] {
  const seen = new Set<string>()
  const out: { name: string; shortName: string | null }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const [namePart, shortPart] = line.split('|')
    const name = namePart.trim()
    if (name.length < 2) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, shortName: shortPart?.trim() || null })
  }
  return out
}

function AddChildForm({ parentId, depth, onCancel, onSubmit, onSubmitBulk, pending }: {
  parentId: string; depth: number; pending: boolean
  onCancel:     () => void
  onSubmit:     (input: { parentId: string; typeCode: Exclude<OrgUnitType, 'institution'>; name: string; shortName: string | null } & OrgUnitMeta) => void
  onSubmitBulk: (input: { parentId: string; typeCode: Exclude<OrgUnitType, 'institution'>; units: { name: string; shortName: string | null }[] }) => void
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [typeCode, setTypeCode] = useState<Exclude<OrgUnitType, 'institution'>>('department')
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [meta, setMeta] = useState<MetaForm>(emptyMeta)
  // For programme units the tree name is derived from код + наименование, so the
  // admin types those once. `nameEdited` flips true the moment they touch the
  // Название field directly, which stops the auto-sync (custom label wins).
  const [nameEdited, setNameEdited] = useState(false)

  const parsed = useMemo(() => parseBulkUnits(bulkText), [bulkText])
  const isProgramme = PROGRAMME_TYPES.has(typeCode)

  useEffect(() => {
    if (!isProgramme || nameEdited) return
    setName([meta.code.trim(), meta.specialtyName.trim()].filter(Boolean).join(' '))
  }, [isProgramme, nameEdited, meta.code, meta.specialtyName])

  function submitSingle() {
    if (name.trim().length < 2) return
    onSubmit({
      parentId, typeCode, name: name.trim(), shortName: shortName.trim() || null,
      ...(isProgramme ? metaToPayload(meta) : {}),
    })
    setName(''); setShortName(''); setMeta(emptyMeta); setNameEdited(false)
  }
  function submitBulk() {
    if (parsed.length === 0) return
    onSubmitBulk({ parentId, typeCode, units: parsed })
    setBulkText('')
  }

  const tabBase  = 'text-xs font-sans px-2.5 py-1 rounded-sm transition-colors cursor-pointer'
  const tabOn    = 'bg-amber-light text-amber font-medium'
  const tabOff   = 'text-ink-secondary hover:text-ink'

  return (
    <div
      className="bg-surface-warm border border-border rounded-lg px-3 py-3 mt-1 space-y-2"
      style={{ marginLeft: depth * 22 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-sans text-ink-tertiary uppercase tracking-wider">Режим</span>
        <button type="button" onClick={() => setMode('single')}    className={`${tabBase} ${mode === 'single' ? tabOn : tabOff}`}>Одно</button>
        <button type="button" onClick={() => setMode('bulk')}      className={`${tabBase} ${mode === 'bulk'   ? tabOn : tabOff}`}>Списком</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[11px] font-sans text-ink-secondary block mb-1">Тип</span>
          <select
            value={typeCode} onChange={(e) => setTypeCode(e.target.value as any)}
            className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong"
          >
            {CREATABLE.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        {mode === 'single' ? (
          <>
            <label className="block flex-1 min-w-[180px]">
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">
                Название{isProgramme && <span className="text-ink-tertiary"> — составляется из кода и наименования</span>}
              </span>
              <input
                autoFocus value={name}
                onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSingle() }}
                placeholder={isProgramme ? '09.03.01 Информатика и вычислительная техника' : 'Кафедра физики'}
                className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong"
              />
            </label>
            <label className="block w-28">
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">Сокращение</span>
              <input
                value={shortName} onChange={(e) => setShortName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSingle() }}
                placeholder="КФ"
                className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong"
              />
            </label>
          </>
        ) : (
          <label className="block flex-1 min-w-[260px]">
            <span className="text-[11px] font-sans text-ink-secondary block mb-1">
              По одному в строке: <span className="font-mono text-ink-tertiary">Название | Сокращение</span> (сокращение необязательно)
            </span>
            <textarea
              autoFocus value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={'Кафедра физики | КФ\nКафедра химии | КХ\nКафедра математики'}
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong resize-y"
            />
          </label>
        )}
      </div>

      {/* ФГОС metadata — only when adding a single programme-anchor unit. */}
      {mode === 'single' && isProgramme && (
        <ProgrammeMetaFields value={meta} onChange={setMeta} />
      )}

      <div className="flex items-center gap-2">
        {mode === 'single' ? (
          <Button onClick={submitSingle} loading={pending}>Добавить</Button>
        ) : (
          <>
            <Button onClick={submitBulk} loading={pending} disabled={parsed.length === 0}>
              Добавить {parsed.length > 0 ? `(${parsed.length})` : ''}
            </Button>
            {bulkText.trim() !== '' && parsed.length === 0 && (
              <span className="text-xs font-sans text-warning">Каждое название — минимум 2 символа</span>
            )}
          </>
        )}
        <button onClick={onCancel} className="text-xs font-sans text-ink-secondary hover:text-ink px-2 py-1">Отмена</button>
      </div>
    </div>
  )
}

// Re-type + move panel. Type drives authorisation, and moving rewrites the
// subtree's paths — both are deliberate, audited operations, kept out of the
// quick inline rename. Cycle prevention: a unit cannot move under itself or any
// of its own descendants (path-prefix test; the backend guards this too).
function ManageUnitPanel({ node, depth, allUnits, onRetype, onMove, onSaveMeta, pending, onClose }: {
  node: OrgUnit; depth: number; allUnits: OrgUnit[]
  onRetype:   (typeCode: Exclude<OrgUnitType, 'institution'>) => void
  onMove:     (newParentId: string) => void
  onSaveMeta: (meta: OrgUnitMeta) => void
  pending:    boolean
  onClose:    () => void
}) {
  const [typeCode, setTypeCode] = useState<Exclude<OrgUnitType, 'institution'>>(
    node.type_code === 'institution' ? 'department' : node.type_code
  )
  const [meta, setMeta] = useState<MetaForm>(metaFromUnit(node))
  // Valid new parents: any unit that is not this unit and not one of its
  // descendants (would create a cycle), and not the current parent (no-op).
  const parentOptions = useMemo(
    () => allUnits.filter((u) =>
      !u.path.startsWith(node.path) && u.id !== node.parent_id
    ),
    [allUnits, node.path, node.parent_id]
  )
  const [newParentId, setNewParentId] = useState(parentOptions[0]?.id ?? '')

  const selectCls =
    'text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong'

  return (
    <div
      className="bg-surface-warm border border-border rounded-lg px-3 py-3 mt-1 space-y-3"
      style={{ marginLeft: depth * 22 }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[11px] font-sans text-ink-secondary block mb-1">Тип подразделения</span>
          <select value={typeCode} onChange={(e) => setTypeCode(e.target.value as any)} className={selectCls}>
            {CREATABLE.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <Button onClick={() => onRetype(typeCode)} loading={pending} disabled={typeCode === node.type_code}>
          Изменить тип
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 pt-2.5 border-t border-border">
        <label className="block flex-1 min-w-[240px]">
          <span className="text-[11px] font-sans text-ink-secondary block mb-1">Переместить под</span>
          <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)} className={`${selectCls} w-full`}
            title={allUnits.find((u) => u.id === newParentId)?.name ?? ''}>
            {parentOptions.length === 0 && <option value="">Нет доступных родителей</option>}
            {parentOptions.map((u) => <option key={u.id} value={u.id}>{TYPE_LABEL[u.type_code]}: {u.name}</option>)}
          </select>
        </label>
        <Button onClick={() => newParentId && onMove(newParentId)} loading={pending} disabled={!newParentId}>
          Переместить
        </Button>
      </div>

      {/* ФГОС metadata — only for programme-anchor units. Fills the РОП's */}
      {/* import form when they later pick this unit. */}
      {PROGRAMME_TYPES.has(node.type_code) && (
        <div className="pt-2.5 border-t border-border space-y-2">
          <ProgrammeMetaFields value={meta} onChange={setMeta} />
          <Button onClick={() => onSaveMeta(metaToPayload(meta))} loading={pending}>
            Сохранить данные программы
          </Button>
        </div>
      )}

      <div>
        <button onClick={onClose} className="text-xs font-sans text-ink-secondary hover:text-ink px-2 py-1">Закрыть</button>
      </div>
    </div>
  )
}

function IconBtn({ children, label, onClick, danger = false }: {
  children: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick} title={label} aria-label={label}
      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
        danger ? 'text-ink-tertiary hover:text-danger hover:bg-danger-bg' : 'text-ink-tertiary hover:text-ink hover:bg-surface-warm'
      }`}
    >
      {children}
    </button>
  )
}

// Stroke-style icons matching the app's editorial vocabulary (no emoji glyphs).
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
const PlusIcon   = () => <Svg><path d="M12 5v14" /><path d="M5 12h14" /></Svg>
const CheckIcon  = () => <Svg><path d="M20 6 9 17l-5-5" /></Svg>
const XIcon      = () => <Svg><path d="M18 6 6 18" /><path d="M6 6l12 12" /></Svg>
const PencilIcon = () => <Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>
const TrashIcon  = () => <Svg><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Svg>
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
  </svg>
)
const WarnIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
)
const GearIcon   = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Svg>
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)
