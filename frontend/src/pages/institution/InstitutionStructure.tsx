import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getOrgStructure, createOrgUnit, bulkCreateOrgUnits, updateOrgUnit, deleteOrgUnit,
  getMembers, setPrimaryUnit, grantRole, revokeRole,
  type OrgUnit, type OrgUnitType, type InstitutionMember, type UnitRole,
} from '../../api/orgStructure'

const TYPE_LABEL: Record<OrgUnitType, string> = {
  institution:  'Организация',
  governance:   'Руководство',
  admin_office: 'Управление / центр',
  cluster:      'Полигруппа',
  direction:    'Направление',
  division:     'Институт / факультет',
  program:      'Образовательная программа',
  department:   'Кафедра',
}

const ROLE_LABEL: Record<UnitRole, string> = {
  admin:  'Администратор',
  head:   'Руководитель',
  viewer: 'Наблюдатель',
}

// Short label for a unit in chips / selects — short_name when present.
const unitLabel = (u?: OrgUnit) => (u ? (u.short_name || u.name) : '—')

// Order offered in the "add child" picker — institution excluded (roots are not
// created here). Flexible depth: any of these may nest under any parent (§7.1).
const CREATABLE: Exclude<OrgUnitType, 'institution'>[] =
  ['governance', 'admin_office', 'cluster', 'direction', 'division', 'program', 'department']

// Default-collapsed types — at the институт level and below, kafedra lists get
// long fast. Management chain (root / governance / admin_office / cluster)
// stays open so the overall shape of the org is always visible.
const DEFAULT_COLLAPSED_TYPES = new Set<OrgUnitType>(['division', 'program', 'department'])
const EXPANDED_STORAGE_KEY = 'ga_org_expanded_v1'

interface TreeNode extends OrgUnit { children: TreeNode[] }

function buildTree(units: OrgUnit[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  units.forEach((u) => byId.set(u.id, { ...u, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id)!.children.push(node)
    else roots.push(node)
  })
  return roots
}

export default function InstitutionStructure() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data: units = [], isLoading } = useQuery({ queryKey: ['org-structure'], queryFn: getOrgStructure })
  const tree = useMemo(() => buildTree(units), [units])

  const [addingUnder, setAddingUnder] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

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
                  key={node.id} node={node} depth={0}
                  addingUnder={addingUnder} openAddUnder={openAddUnder}
                  editing={editing} setEditing={setEditing}
                  isExpanded={isExpanded} toggleExpanded={toggleExpanded}
                  createMut={createMut} bulkMut={bulkMut} updateMut={updateMut} deleteMut={deleteMut}
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-members'] })
  const onError = (err: any) => addToast(err?.response?.data?.error ?? 'Не удалось сохранить', 'error')

  const primaryMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string }) => setPrimaryUnit(v.teacherId, v.unitId),
    onSuccess: () => { invalidate(); addToast('Кафедра обновлена', 'success') }, onError,
  })
  const grantMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string; role: UnitRole }) => grantRole(v.teacherId, v.unitId, v.role),
    onSuccess: () => { invalidate(); addToast('Роль назначена', 'success') }, onError,
  })
  const revokeMut = useMutation({
    mutationFn: (v: { teacherId: string; unitId: string; role: UnitRole }) => revokeRole(v.teacherId, v.unitId, v.role),
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
        <div className="space-y-2">
          {members.map((m) => (
            <MemberRow
              key={m.id} member={m} departments={departments} units={units} unitsById={unitsById}
              onSetPrimary={(unitId) => primaryMut.mutate({ teacherId: m.id, unitId })}
              onGrant={(unitId, role) => grantMut.mutate({ teacherId: m.id, unitId, role })}
              onRevoke={(unitId, role) => revokeMut.mutate({ teacherId: m.id, unitId, role })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MemberRow({ member, departments, units, unitsById, onSetPrimary, onGrant, onRevoke }: {
  member: InstitutionMember
  departments: OrgUnit[]
  units: OrgUnit[]
  unitsById: Map<string, OrgUnit>
  onSetPrimary: (unitId: string) => void
  onGrant: (unitId: string, role: UnitRole) => void
  onRevoke: (unitId: string, role: UnitRole) => void
}) {
  const [adding, setAdding] = useState(false)
  const [roleUnit, setRoleUnit] = useState(units[0]?.id ?? '')
  const [role, setRole] = useState<UnitRole>('head')

  const selectCls =
    'text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none ' +
    'focus:border-border-strong text-ellipsis cursor-pointer'

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
            const full = `${ROLE_LABEL[r.role]} · ${unitsById.get(r.org_unit_id)?.name ?? ''}`
            return (
              <span key={`${r.org_unit_id}-${r.role}`} title={full}
                className="inline-flex items-center gap-1 max-w-[240px] text-xs font-sans bg-amber-light text-amber border border-amber/20 rounded-sm pl-2 pr-1 py-0.5">
                <span className="truncate">{ROLE_LABEL[r.role]} · {unitLabel(unitsById.get(r.org_unit_id))}</span>
                <button onClick={() => onRevoke(r.org_unit_id, r.role)} aria-label="Снять роль"
                  className="text-amber/60 hover:text-danger transition-colors leading-none flex-shrink-0">×</button>
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

      {/* Grant a role — own full-width line so long unit names have room */}
      {adding && (
        <div className="flex flex-wrap items-end gap-2 pt-2.5 border-t border-border">
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
              {(['admin', 'head', 'viewer'] as UnitRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button onClick={() => { if (roleUnit) { onGrant(roleUnit, role); setAdding(false) } }}
            className="px-3 py-1.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity">
            Назначить
          </button>
          <button onClick={() => setAdding(false)}
            className="px-2 py-1.5 text-sm font-sans text-ink-secondary hover:text-ink transition-colors">
            Отмена
          </button>
        </div>
      )}
    </div>
  )
}

function UnitRow({
  node, depth, addingUnder, openAddUnder, editing, setEditing,
  isExpanded, toggleExpanded,
  createMut, bulkMut, updateMut, deleteMut,
}: {
  node: TreeNode; depth: number
  addingUnder: string | null; openAddUnder: (id: string) => void
  editing: string | null; setEditing: (v: string | null) => void
  isExpanded: (u: OrgUnit) => boolean
  toggleExpanded: (id: string) => void
  createMut: ReturnType<typeof useMutation<any, any, any>>
  bulkMut:   ReturnType<typeof useMutation<any, any, any>>
  updateMut: ReturnType<typeof useMutation<any, any, any>>
  deleteMut: ReturnType<typeof useMutation<any, any, any>>
}) {
  const isRoot = !node.parent_id
  const [editName, setEditName] = useState(node.name)
  const hasChildren = node.children.length > 0
  const expanded = isExpanded(node)

  return (
    <div>
      <div
        className="flex items-center gap-2.5 bg-surface border border-border rounded-lg px-3 py-2.5 hover:border-border-mid transition-colors"
        style={{ marginLeft: depth * 22 }}
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

        <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary bg-surface-warm border border-border rounded-sm px-1.5 py-0.5 flex-shrink-0">
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
                <IconBtn
                  label="Удалить" danger
                  onClick={() => { if (confirm(`Удалить «${node.name}»?`)) deleteMut.mutate(node.id) }}
                ><TrashIcon /></IconBtn>
              )}
            </>
          )}
        </div>
      </div>

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
          key={child.id} node={child} depth={depth + 1}
          addingUnder={addingUnder} openAddUnder={openAddUnder}
          editing={editing} setEditing={setEditing}
          isExpanded={isExpanded} toggleExpanded={toggleExpanded}
          createMut={createMut} bulkMut={bulkMut} updateMut={updateMut} deleteMut={deleteMut}
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
  onSubmit:     (input: { parentId: string; typeCode: Exclude<OrgUnitType, 'institution'>; name: string; shortName: string | null }) => void
  onSubmitBulk: (input: { parentId: string; typeCode: Exclude<OrgUnitType, 'institution'>; units: { name: string; shortName: string | null }[] }) => void
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [typeCode, setTypeCode] = useState<Exclude<OrgUnitType, 'institution'>>('department')
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [bulkText, setBulkText] = useState('')

  const parsed = useMemo(() => parseBulkUnits(bulkText), [bulkText])

  function submitSingle() {
    if (name.trim().length < 2) return
    onSubmit({ parentId, typeCode, name: name.trim(), shortName: shortName.trim() || null })
    setName(''); setShortName('')
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
              <span className="text-[11px] font-sans text-ink-secondary block mb-1">Название</span>
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSingle() }}
                placeholder="Кафедра физики"
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
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)
