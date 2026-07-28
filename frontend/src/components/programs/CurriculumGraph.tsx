import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getDisciplineContentUnits } from '../../api/programs'
import type {
  ProgramDetail, ProgramDiscipline, ProgramTopology, ProgramAnalysis, ProgramContentUnit,
  CompetencyLinkStage, ContentSection,
} from '../../types'

// The «Топология» tab's third pass — an actual node-and-edge graph, not a
// table or a set of progress bars. Disciplines and competencies are nodes;
// `prerequisite` and `contributes-to` edges connect them. Deliberately a
// deterministic grid layout, not force-directed — no graph-layout library
// exists anywhere in this codebase, and force-directed placement is
// non-deterministic for a curriculum a РОП needs to recognise run to run.
//
// Default view is the discipline skeleton (positioned by semester) plus a
// compact competency "landmark" column — code + status dot only, no edges,
// no labels. Clicking a node reveals its specific connections (and, for a
// discipline, its content units via a lazy fetch) in the detail panel below.
// ФОС placeholders sit next to every competency landmark, always — there is
// no ФОС data yet (Increment 3a), so the gap itself is the visible fact.

const SEMESTER_WIDTH   = 150
const ROW_HEIGHT       = 34
const MARGIN           = 20
const LANDMARK_GAP     = 60   // gap between the last semester column and the competency column
const NODE_W           = 128
const NODE_H           = 26
const FOS_DOT_OFFSET   = 92   // ФОС placeholder sits this far right of its competency's code

const STAGE_COLOR: Record<CompetencyLinkStage, string> = {
  introduce: 'rgb(var(--color-success-rgb) / 0.35)',
  develop:   'rgb(var(--color-success-rgb) / 0.7)',
  master:    'var(--color-success)',
}
const STAGE_LABEL: Record<CompetencyLinkStage, string> = {
  introduce: 'Введение', develop: 'Развитие', master: 'Владение',
}
const STATUS_DOT: Record<string, string> = {
  ok: 'var(--color-success)', thin: 'var(--color-warning)', late: 'var(--color-warning)', uncovered: 'var(--color-danger)',
}
const SECTION_LABEL: Record<ContentSection, string> = {
  lectures: 'Лекции', practicals: 'Практические', labs: 'Лабораторные', independent: 'СРС', control: 'Контроль',
}

type Selected = { kind: 'discipline'; id: string } | { kind: 'competency'; id: string } | null

export default function CurriculumGraph({
  program, topology, duration, analysis,
}: {
  program:  ProgramDetail
  topology: ProgramTopology
  duration: number
  analysis: ProgramAnalysis
}) {
  const [selected, setSelected] = useState<Selected>(null)
  const [contentUnits, setContentUnits] = useState<ProgramContentUnit[] | null>(null)
  const [loadingUnits, setLoadingUnits] = useState(false)

  const disciplineById = useMemo(() => {
    const m = new Map<string, ProgramDiscipline>()
    for (const d of program.disciplines) if (d.id) m.set(d.id, d)
    return m
  }, [program.disciplines])

  // Grid positions — x by semester, y by index within that semester
  // (sorted by sort_order, same ordering the builder tab already uses).
  const { disciplinePositions, maxRowsInSemester } = useMemo(() => {
    const bySemester = new Map<number, ProgramDiscipline[]>()
    for (const d of program.disciplines) {
      if (!bySemester.has(d.semester)) bySemester.set(d.semester, [])
      bySemester.get(d.semester)!.push(d)
    }
    for (const list of bySemester.values()) list.sort((a, b) => a.sort_order - b.sort_order)

    const pos = new Map<string, { x: number; y: number }>()
    let maxRows = 1
    for (let s = 1; s <= duration; s++) {
      const list = bySemester.get(s) ?? []
      maxRows = Math.max(maxRows, list.length)
      list.forEach((d, i) => {
        if (d.id) pos.set(d.id, { x: MARGIN + (s - 1) * SEMESTER_WIDTH, y: MARGIN + i * ROW_HEIGHT })
      })
    }
    return { disciplinePositions: pos, maxRowsInSemester: maxRows }
  }, [program.disciplines, duration])

  const competencyColX = MARGIN + duration * SEMESTER_WIDTH + LANDMARK_GAP
  const competencyPositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    program.competencies.forEach((c, i) => {
      if (c.id) pos.set(c.id, { x: competencyColX, y: MARGIN + i * ROW_HEIGHT })
    })
    return pos
  }, [program.competencies, competencyColX])

  const statusByCompetencyId = useMemo(() => {
    const byKey = new Map(analysis.progression.map((r) => [r.code ?? r.title, r.status]))
    const m = new Map<string, string>()
    for (const c of program.competencies) if (c.id) m.set(c.id, byKey.get(c.code ?? c.title) ?? 'uncovered')
    return m
  }, [program.competencies, analysis])

  const canvasWidth  = competencyColX + FOS_DOT_OFFSET + 40
  const canvasHeight = MARGIN + Math.max(maxRowsInSemester, program.competencies.length) * ROW_HEIGHT + 20

  useEffect(() => {
    if (selected?.kind !== 'discipline') { setContentUnits(null); return }
    let cancelled = false
    setContentUnits(null)
    setLoadingUnits(true)
    getDisciplineContentUnits(program.id, selected.id)
      .then((units) => { if (!cancelled) setContentUnits(units) })
      .catch(() => { if (!cancelled) setContentUnits([]) })
      .finally(() => { if (!cancelled) setLoadingUnits(false) })
    return () => { cancelled = true }
  }, [selected, program.id])

  function toggle(next: Exclude<Selected, null>) {
    setSelected((prev) => (prev && prev.kind === next.kind && prev.id === next.id ? null : next))
  }

  const selectedDisciplineLinks = selected?.kind === 'discipline'
    ? topology.competencyLinks.filter((l) => l.discipline_id === selected.id)
    : []
  const selectedCompetencyLinks = selected?.kind === 'competency'
    ? topology.competencyLinks.filter((l) => l.competency_id === selected.id)
    : []

  const center = (p: { x: number; y: number }) => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 })

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-lg p-4 overflow-auto" style={{ maxHeight: 560 }}>
        <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
          <svg className="absolute top-0 left-0 pointer-events-none" width={canvasWidth} height={canvasHeight}>
            {/* Skeleton — prerequisite edges, always drawn. Red if inverted,
                bold when touching the current selection. */}
            {topology.prerequisites.map((p) => {
              const fromPos = disciplinePositions.get(p.prerequisite_discipline_id)
              const toPos = disciplinePositions.get(p.discipline_id)
              if (!fromPos || !toPos) return null
              const from = center(fromPos), to = center(toPos)
              const touching = selected?.kind === 'discipline' &&
                (selected.id === p.discipline_id || selected.id === p.prerequisite_discipline_id)
              return (
                <line key={p.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={p.inverted ? 'var(--color-danger)' : 'var(--color-border-strong)'}
                      strokeWidth={touching ? 2 : 1} opacity={touching ? 1 : 0.4} />
              )
            })}
            {/* Discipline → competency edges, only for the current selection. */}
            {selectedDisciplineLinks.map((l) => {
              const fromPos = disciplinePositions.get(l.discipline_id)
              const toPos = competencyPositions.get(l.competency_id)
              if (!fromPos || !toPos) return null
              const from = center(fromPos)
              return (
                <line key={l.id} x1={from.x} y1={from.y} x2={toPos.x} y2={toPos.y}
                      stroke={STAGE_COLOR[l.stage]} strokeWidth={2} />
              )
            })}
            {selectedCompetencyLinks.map((l) => {
              const fromPos = disciplinePositions.get(l.discipline_id)
              const toPos = competencyPositions.get(l.competency_id)
              if (!fromPos || !toPos) return null
              const from = center(fromPos)
              return (
                <line key={l.id} x1={from.x} y1={from.y} x2={toPos.x} y2={toPos.y}
                      stroke={STAGE_COLOR[l.stage]} strokeWidth={2} />
              )
            })}
          </svg>

          {/* Discipline nodes */}
          {program.disciplines.map((d) => {
            if (!d.id) return null
            const p = disciplinePositions.get(d.id)
            if (!p) return null
            const isSelected = selected?.kind === 'discipline' && selected.id === d.id
            const isConnected = selected?.kind === 'competency' &&
              selectedCompetencyLinks.some((l) => l.discipline_id === d.id)
            return (
              <button key={d.id} onClick={() => toggle({ kind: 'discipline', id: d.id! })}
                title={d.name}
                className={`absolute text-left rounded-md border px-1.5 py-1 text-[9px] leading-tight truncate transition-colors ${
                  isSelected || isConnected
                    ? 'bg-amber-light border-amber text-ink font-medium'
                    : 'bg-surface-warm border-border text-ink-secondary hover:border-border-strong'
                }`}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}>
                {d.name}
              </button>
            )
          })}

          {/* Competency landmarks + ФОС placeholders */}
          {program.competencies.map((c) => {
            if (!c.id) return null
            const p = competencyPositions.get(c.id)
            if (!p) return null
            const isSelected = selected?.kind === 'competency' && selected.id === c.id
            const isConnected = selected?.kind === 'discipline' &&
              selectedDisciplineLinks.some((l) => l.competency_id === c.id)
            return (
              <div key={c.id}>
                <button onClick={() => toggle({ kind: 'competency', id: c.id! })}
                  title={c.title}
                  className={`absolute flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-mono transition-colors ${
                    isSelected || isConnected
                      ? 'bg-amber-light border-amber text-ink font-medium'
                      : 'bg-surface border-border text-ink-secondary hover:border-border-strong'
                  }`}
                  style={{ left: p.x, top: p.y - NODE_H / 2 + 4, height: 20 }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                        style={{ background: STATUS_DOT[statusByCompetencyId.get(c.id) ?? 'uncovered'] }} />
                  {c.code ?? c.title.slice(0, 10)}
                </button>
                <span title="Нет данных ФОС — появится с Increment 3a"
                      className="absolute w-2.5 h-2.5 rounded-full border border-dashed border-ink-tertiary"
                      style={{ left: p.x + FOS_DOT_OFFSET, top: p.y - NODE_H / 2 + 8 }} />
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <NodeDetailPanel
          selected={selected} program={program} topology={topology} analysis={analysis}
          contentUnits={contentUnits} loadingUnits={loadingUnits}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function NodeDetailPanel({
  selected, program, topology, analysis, contentUnits, loadingUnits, onClose,
}: {
  selected:      Exclude<Selected, null>
  program:       ProgramDetail
  topology:      ProgramTopology
  analysis:      ProgramAnalysis
  contentUnits:  ProgramContentUnit[] | null
  loadingUnits:  boolean
  onClose:       () => void
}) {
  const disciplineById = useMemo(() => {
    const m = new Map<string, ProgramDiscipline>()
    for (const d of program.disciplines) if (d.id) m.set(d.id, d)
    return m
  }, [program.disciplines])

  const Header = ({ children }: { children: ReactNode }) => (
    <div className="flex items-center justify-between mb-3">
      <div className="text-sm font-sans font-medium text-ink">{children}</div>
      <button onClick={onClose} className="text-ink-tertiary hover:text-ink text-xs font-sans">Закрыть ×</button>
    </div>
  )

  if (selected.kind === 'discipline') {
    const d = disciplineById.get(selected.id)
    if (!d) return null
    const outgoing = topology.prerequisites.filter((p) => p.prerequisite_discipline_id === selected.id)
    const incoming = topology.prerequisites.filter((p) => p.discipline_id === selected.id)
    const links = topology.competencyLinks.filter((l) => l.discipline_id === selected.id)
    const competencyById = new Map(program.competencies.map((c) => [c.id, c]))
    const unitsBySection = new Map<ContentSection, ProgramContentUnit[]>()
    for (const u of contentUnits ?? []) {
      if (!unitsBySection.has(u.section)) unitsBySection.set(u.section, [])
      unitsBySection.get(u.section)!.push(u)
    }

    return (
      <div className="bg-surface border border-border rounded-lg p-4">
        <Header>{d.name} <span className="text-ink-tertiary font-normal">· сем. {d.semester}{d.credits != null ? ` · ${d.credits} з.е.` : ''}</span></Header>
        <div className="grid md:grid-cols-2 gap-4 text-xs font-sans">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Компетенции</div>
            {links.length === 0
              ? <p className="text-ink-tertiary">Не связана ни с одной компетенцией.</p>
              : links.map((l) => {
                  const c = competencyById.get(l.competency_id)
                  return c ? (
                    <div key={l.id} className="flex items-center gap-1.5">
                      <span className="font-mono text-ink-secondary">{c.code ?? c.title}</span>
                      <span className="text-ink-tertiary">— {STAGE_LABEL[l.stage]}</span>
                    </div>
                  ) : null
                })}

            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary pt-2">Последовательность</div>
            {outgoing.length === 0 && incoming.length === 0 && <p className="text-ink-tertiary">Связей не выявлено.</p>}
            {outgoing.map((p) => {
              const to = disciplineById.get(p.discipline_id)
              return to ? (
                <div key={p.id} className={p.inverted ? 'text-danger' : 'text-ink-secondary'}>
                  → основа для «{to.name}»{p.inverted && ' (нарушение порядка)'}
                </div>
              ) : null
            })}
            {incoming.map((p) => {
              const from = disciplineById.get(p.prerequisite_discipline_id)
              return from ? (
                <div key={p.id} className={p.inverted ? 'text-danger' : 'text-ink-secondary'}>
                  ← опирается на «{from.name}»{p.inverted && ' (нарушение порядка)'}
                </div>
              ) : null
            })}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Содержание (практики, лекции…)</div>
            {loadingUnits && <p className="text-ink-tertiary">Загружаем…</p>}
            {!loadingUnits && (contentUnits?.length ?? 0) === 0 && (
              <p className="text-ink-tertiary">Содержание не извлечено — нет загруженной РПД или анализ ещё не запускался.</p>
            )}
            {!loadingUnits && [...unitsBySection.entries()].map(([section, units]) => (
              <div key={section}>
                <div className="text-ink font-medium">{SECTION_LABEL[section]}</div>
                <ul className="list-disc list-inside text-ink-secondary">
                  {units.map((u) => <li key={u.id} className="truncate">{u.title}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Competency selected
  const c = program.competencies.find((x) => x.id === selected.id)
  if (!c) return null
  const links = topology.competencyLinks.filter((l) => l.competency_id === selected.id)
  const row = analysis.progression.find((r) => (r.code ?? r.title) === (c.code ?? c.title))

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <Header>{c.code && <span className="font-mono">{c.code} </span>}{c.title}</Header>
      <div className="text-xs font-sans space-y-2">
        {row && <p className="text-ink-secondary">{row.note || `Статус: ${row.status}`}</p>}
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Формируется дисциплинами</div>
        {links.length === 0
          ? <p className="text-ink-tertiary">Ни одна дисциплина не связана с этой компетенцией.</p>
          : links.map((l) => {
              const d = disciplineById.get(l.discipline_id)
              return d ? (
                <div key={l.id} className="flex items-center gap-1.5">
                  <span className="text-ink-secondary">{d.name} (сем. {d.semester})</span>
                  <span className="text-ink-tertiary">— {STAGE_LABEL[l.stage]}</span>
                </div>
              ) : null
            })}
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary pt-2">ФОС</div>
        <p className="text-ink-tertiary">Нет данных — появится с Increment 3a (интеграция фонда оценочных средств).</p>
      </div>
    </div>
  )
}
