import type { ProgramCompetency, FgosCompetency } from '../../../shared/types'

// Bridges programs.level (English 'bachelor'|'master'|'specialist') and the
// sveden.ru-import-only education_level free text onto fgos_standards.level
// (Russian 'бакалавриат'|'магистратура'|'специалитет'|'аспирантура'). Moved
// here (was routes/programs.ts) so the topology substrate's server-side
// ФГОС-competency resolution (see matchProgramCompetenciesToFgos below) can
// use it without a service importing a route file.
const PROGRAM_LEVEL_TO_FGOS_LEVEL: Record<string, string> = {
  bachelor: 'бакалавриат', master: 'магистратура', specialist: 'специалитет',
}

// FGOS registry level terms — used as a fallback to read a level out of
// `education_level` (free text, e.g. "Высшее образование — бакалавриат", set
// by the programme import form's «Уровень образования» field) when the
// separate `level` enum column was never populated. The two columns are
// filled by different code paths (`level` only by direct program creation,
// `education_level` by the sveden.ru bulk-import flow) and nothing links
// them — found 2026-07-24 when every real imported programme had
// `education_level` set but `level` null, so a РОП who'd genuinely filled in
// "Уровень образования" at import time still hit "не указан уровень
// образования" here. `fgos_standards.level` is already these exact Russian
// terms, so a substring match needs no further mapping.
const FGOS_LEVEL_TERMS = ['бакалавриат', 'магистратура', 'специалитет', 'аспирантура']

export function inferFgosLevel(detail: { level: string | null; education_level: string | null }): string | null {
  if (detail.level && PROGRAM_LEVEL_TO_FGOS_LEVEL[detail.level]) return PROGRAM_LEVEL_TO_FGOS_LEVEL[detail.level]
  const text = (detail.education_level ?? '').toLowerCase()
  return FGOS_LEVEL_TERMS.find((term) => text.includes(term)) ?? null
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// A programme competency's code carries its ФГОС type as a prefix ('УК-1',
// 'ОПК-3'). ПК codes ('ПК-2') never resolve — fgos_competencies.type CHECK
// excludes ПК by design (ПК are programme-owned, not federal, per ФГОС 3++
// methodology) — so a code with no matching prefix is left unmatched here
// rather than guessed at.
function inferFgosType(code: string): 'УК' | 'ОПК' | null {
  const upper = code.trim().toUpperCase()
  if (upper.startsWith('УК')) return 'УК'
  if (upper.startsWith('ОПК')) return 'ОПК'
  return null
}

// Topology graph substrate (docs/topology-spec.md, Increment 0) — resolves a
// programme's free-text competency codes onto the platform's canonical ФГОС
// registry. Pure: takes both sides already loaded (the caller fetches
// `program_competencies` and, via findPublishedFgosCompetencies, the
// direction+level's published fgos_competencies), matches by normalized code
// AND inferred type together (a code collision across types, e.g. a typo'd
// "УК-1" meant as "ОПК-1", should never cross-match). Unmatched competencies
// (ПК, goals, or codes with no counterpart in the registry) are simply
// absent from the result — the caller leaves their fgos_competency_id null.
export function matchProgramCompetenciesToFgos(
  competencies: ProgramCompetency[],
  fgosCompetencies: FgosCompetency[],
): { competencyId: string; fgosCompetencyId: string }[] {
  const registry = new Map(
    fgosCompetencies
      .filter((c) => c.id)
      .map((c) => [`${c.type}:${norm(c.code)}`, c.id as string])
  )

  const matches: { competencyId: string; fgosCompetencyId: string }[] = []
  for (const c of competencies) {
    if (!c.id || !c.code) continue
    const type = inferFgosType(c.code)
    if (!type) continue
    const fgosId = registry.get(`${type}:${norm(c.code)}`)
    if (fgosId) matches.push({ competencyId: c.id, fgosCompetencyId: fgosId })
  }
  return matches
}
