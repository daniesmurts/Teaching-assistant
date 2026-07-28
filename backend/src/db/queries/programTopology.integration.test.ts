import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { pool } from '../connection'
import {
  replacePrerequisites, listPrerequisites,
  replaceCompetencyLinks, listCompetencyLinks,
  replaceContentUnits, listContentUnitsByDiscipline, hasContentUnitsForDocument,
} from './programTopology'
import { insertProgramDocument } from './programDocuments'
import {
  createTestTeacher, createTestInstitution, createTestProgram,
  createTestProgramDisciplines, createTestProgramCompetencies,
} from '../__tests__/fixtures'

/** program_content_units.source_doc_id FKs onto a real program_documents
 *  row — a random uuid would fail the constraint, so tests use a minimal
 *  real document via the production insert function rather than a bare id. */
async function testDocument(programId: string, disciplineId: string, teacherId: string): Promise<string> {
  const doc = await insertProgramDocument({
    programId, kind: 'working_programme', practiceType: null, disciplineId,
    fileName: 'test.pdf', fileSize: 1, mimeType: 'application/pdf', storagePath: 'test/path',
    extractedText: null, uploadedBy: teacherId,
  })
  return doc.id
}

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function setup() {
  const teacher = await createTestTeacher()
  const institution = await createTestInstitution()
  const program = await createTestProgram(institution.id, teacher.id)
  const [d1, d2] = await createTestProgramDisciplines(institution.id, program.id, [
    { name: 'Математика', semester: 1 },
    { name: 'Механика', semester: 3 },
  ])
  return { teacher, institution, program, d1, d2 }
}

describe('replacePrerequisites', () => {
  it('replaces the extracted set while leaving a confirmed edge untouched', async () => {
    const { program, d1, d2 } = await setup()

    await replacePrerequisites(program.id, [
      { disciplineId: d2.id!, prerequisiteDisciplineId: d1.id!, reason: 'первая версия', inverted: false },
    ], null)

    const [firstRun] = await listPrerequisites(program.id)
    expect(firstRun.origin).toBe('extracted')

    // A РОП (via a not-yet-built Increment 4 UI) confirms this edge — direct
    // SQL here since no mutation route exists yet.
    await pool.query(`UPDATE program_prerequisites SET origin = 'confirmed' WHERE id = $1`, [firstRun.id])

    // Re-analysis proposes a different reason for the same pair, plus a
    // brand-new extracted edge. createTestProgramDisciplines replaces the
    // WHOLE discipline set, so re-declare all three here, preserving d1/d2's
    // ids (replaceDisciplines is id-preserving) — without that, d1/d2 would
    // be deleted and recreated with fresh ids, orphaning the edges above.
    const disciplines = await createTestProgramDisciplines(program.institution_id, program.id, [
      { id: d1.id, name: 'Математика', semester: 1 },
      { id: d2.id, name: 'Механика', semester: 3 },
      { name: 'Сопромат', semester: 5 },
    ])
    const d3 = disciplines.find((d) => d.name === 'Сопромат')!

    await replacePrerequisites(program.id, [
      { disciplineId: d2.id!, prerequisiteDisciplineId: d1.id!, reason: 'вторая версия', inverted: false },
      { disciplineId: d3.id!, prerequisiteDisciplineId: d2.id!, reason: 'новая связь', inverted: false },
    ], null)

    const after = await listPrerequisites(program.id)
    const confirmedEdge = after.find((e) => e.id === firstRun.id)
    expect(confirmedEdge).toBeDefined()
    expect(confirmedEdge!.origin).toBe('confirmed')
    expect(confirmedEdge!.reason).toBe('первая версия')   // untouched by re-analysis

    const newEdge = after.find((e) => e.prerequisite_discipline_id === d2.id)
    expect(newEdge).toBeDefined()
    expect(newEdge!.origin).toBe('extracted')

    // The confirmed pair does not appear a second time as a duplicate extracted row.
    expect(after.filter((e) => e.discipline_id === d2.id && e.prerequisite_discipline_id === d1.id)).toHaveLength(1)
  })

  it('a plain re-run with an empty set clears extracted edges', async () => {
    const { program, d1, d2 } = await setup()
    await replacePrerequisites(program.id, [
      { disciplineId: d2.id!, prerequisiteDisciplineId: d1.id!, reason: 'x', inverted: false },
    ], null)
    await replacePrerequisites(program.id, [], null)
    expect(await listPrerequisites(program.id)).toHaveLength(0)
  })
})

describe('replaceCompetencyLinks', () => {
  it('replaces the extracted set while leaving a confirmed link untouched', async () => {
    // Identity is (discipline, competency, STAGE) — a discipline legitimately
    // teaches a competency at multiple stages across semesters, so those are
    // different rows, not re-proposals of the same one. The re-analysis-
    // preserves-confirmed guarantee applies to the same (discipline,
    // competency, stage) slot getting a different evidence_quote.
    const { program, d1 } = await setup()
    const [comp] = await createTestProgramCompetencies(program.institution_id, program.id, [{ code: 'УК-1' }])

    await replaceCompetencyLinks(program.id, [
      { disciplineId: d1.id!, competencyId: comp.id!, stage: 'introduce', evidenceQuote: 'первая версия' },
    ], null)

    const [firstRun] = await listCompetencyLinks(program.id)
    await pool.query(`UPDATE program_competency_links SET origin = 'confirmed' WHERE id = $1`, [firstRun.id])

    await replaceCompetencyLinks(program.id, [
      { disciplineId: d1.id!, competencyId: comp.id!, stage: 'introduce', evidenceQuote: 'вторая версия' },
    ], null)

    const after = await listCompetencyLinks(program.id)
    const confirmed = after.find((l) => l.id === firstRun.id)
    expect(confirmed).toBeDefined()
    expect(confirmed!.origin).toBe('confirmed')
    expect(confirmed!.evidence_quote).toBe('первая версия')   // untouched by re-analysis

    // No duplicate extracted row was inserted for the same (discipline, competency, stage) slot.
    expect(after.filter((l) => l.discipline_id === d1.id && l.competency_id === comp.id)).toHaveLength(1)
  })

  it('allows the same discipline to teach a competency at multiple stages simultaneously', async () => {
    const { program, d1 } = await setup()
    const [comp] = await createTestProgramCompetencies(program.institution_id, program.id, [{ code: 'УК-1' }])

    await replaceCompetencyLinks(program.id, [
      { disciplineId: d1.id!, competencyId: comp.id!, stage: 'introduce' },
      { disciplineId: d1.id!, competencyId: comp.id!, stage: 'develop' },
    ], null)

    const links = await listCompetencyLinks(program.id)
    expect(links.map((l) => l.stage).sort()).toEqual(['develop', 'introduce'])
  })
})

describe('replaceContentUnits', () => {
  it('replaces a discipline\'s content units wholesale', async () => {
    const { program, teacher, d1 } = await setup()
    const sourceDocId = await testDocument(program.id, d1.id!, teacher.id)

    await replaceContentUnits(d1.id!, [
      { section: 'lectures', title: 'Введение', topics: ['Тема 1', 'Тема 2'], sortOrder: 0 },
      { section: 'lectures', title: 'Продолжение', topics: [], sortOrder: 1 },
    ], sourceDocId, 'approved')

    const units = await listContentUnitsByDiscipline(d1.id!)
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ title: 'Введение', topics: ['Тема 1', 'Тема 2'], provenance: 'approved' })
    expect(await hasContentUnitsForDocument(d1.id!, sourceDocId)).toBe(true)
    expect(await hasContentUnitsForDocument(d1.id!, randomUUID())).toBe(false)

    await replaceContentUnits(d1.id!, [
      { section: 'labs', title: 'Лабораторная 1', topics: [], sortOrder: 0 },
    ], sourceDocId, 'approved')

    const after = await listContentUnitsByDiscipline(d1.id!)
    expect(after).toHaveLength(1)
    expect(after[0].title).toBe('Лабораторная 1')
  })
})

describe('cascade delete', () => {
  it('removing a discipline leaves no orphaned prerequisite/competency-link/content-unit rows', async () => {
    const { program, teacher, d1, d2 } = await setup()
    const [comp] = await createTestProgramCompetencies(program.institution_id, program.id, [{ code: 'УК-1' }])
    const sourceDocId = await testDocument(program.id, d1.id!, teacher.id)

    await replacePrerequisites(program.id, [
      { disciplineId: d2.id!, prerequisiteDisciplineId: d1.id!, reason: '', inverted: false },
    ], null)
    await replaceCompetencyLinks(program.id, [
      { disciplineId: d1.id!, competencyId: comp.id!, stage: 'introduce' },
    ], null)
    await replaceContentUnits(d1.id!, [
      { section: 'lectures', title: 'Введение', topics: [], sortOrder: 0 },
    ], sourceDocId, 'latest')

    await pool.query('DELETE FROM program_disciplines WHERE id = $1', [d1.id])

    expect(await listPrerequisites(program.id)).toHaveLength(0)
    expect(await listCompetencyLinks(program.id)).toHaveLength(0)
    expect(await listContentUnitsByDiscipline(d1.id!)).toHaveLength(0)
  })
})
