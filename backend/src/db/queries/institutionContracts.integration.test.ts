import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { createTestTeacher, createTestInstitution } from '../__tests__/fixtures'
import {
  listInstitutionContracts, getCurrentInstitutionContract,
  createInstitutionContract, updateInstitutionContract, deleteInstitutionContract,
} from './institutionContracts'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function makeContract(institutionId: string, teacherId: string, overrides?: {
  annualValueRub?: number; seatsPurchased?: number; termStart?: string; termEnd?: string
}) {
  return createInstitutionContract({
    institutionId,
    annualValueRub: overrides?.annualValueRub ?? 500_000,
    seatsPurchased: overrides?.seatsPurchased ?? 100,
    termStart: overrides?.termStart ?? '2026-01-01',
    termEnd:   overrides?.termEnd ?? '2026-12-31',
    createdBy: teacherId,
  })
}

describe('createInstitutionContract', () => {
  it('persists and returns the created row', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    const contract = await makeContract(institution.id, teacher.id, { annualValueRub: 750_000, seatsPurchased: 50 })

    expect(contract.institution_id).toBe(institution.id)
    expect(contract.annual_value_rub).toBe(750_000)
    expect(contract.seats_purchased).toBe(50)
    expect(contract.term_start).toContain('2026-01-01')
    expect(contract.created_by).toBe(teacher.id)
  })
})

describe('listInstitutionContracts', () => {
  it('returns only the given institution\'s contracts, newest term first', async () => {
    const institutionA = await createTestInstitution()
    const institutionB = await createTestInstitution()
    const teacher = await createTestTeacher()

    await makeContract(institutionA.id, teacher.id, { termStart: '2025-01-01', termEnd: '2025-12-31' })
    await makeContract(institutionA.id, teacher.id, { termStart: '2026-01-01', termEnd: '2026-12-31' })
    await makeContract(institutionB.id, teacher.id)

    const rows = await listInstitutionContracts(institutionA.id)
    expect(rows).toHaveLength(2)
    expect(rows[0].term_start).toContain('2026-01-01')   // newest first
    expect(rows.every((r) => r.institution_id === institutionA.id)).toBe(true)
  })
})

describe('getCurrentInstitutionContract', () => {
  it('returns the contract whose term covers the given date', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    await makeContract(institution.id, teacher.id, { termStart: '2025-01-01', termEnd: '2025-12-31' })
    const current = await makeContract(institution.id, teacher.id, { termStart: '2026-01-01', termEnd: '2026-12-31' })

    const found = await getCurrentInstitutionContract(institution.id, '2026-07-30')
    expect(found?.id).toBe(current.id)
  })

  it('returns null when no contract term covers the date — a lapsed/unrenewed deal', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    await makeContract(institution.id, teacher.id, { termStart: '2024-01-01', termEnd: '2024-12-31' })

    const found = await getCurrentInstitutionContract(institution.id, '2026-07-30')
    expect(found).toBeNull()
  })
})

describe('updateInstitutionContract', () => {
  it('updates only the provided fields, leaving the rest untouched', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    const contract = await makeContract(institution.id, teacher.id, { annualValueRub: 500_000, seatsPurchased: 100 })

    const updated = await updateInstitutionContract(contract.id, { seatsPurchased: 150 })
    expect(updated?.seats_purchased).toBe(150)
    expect(updated?.annual_value_rub).toBe(500_000)   // untouched
  })

  it('clears notes when explicitly passed null, distinguishing "not provided" from "clear it"', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    const contract = await createInstitutionContract({
      institutionId: institution.id, annualValueRub: 1, seatsPurchased: 1,
      termStart: '2026-01-01', termEnd: '2026-12-31', notes: 'original note', createdBy: teacher.id,
    })

    const updated = await updateInstitutionContract(contract.id, { notes: null })
    expect(updated?.notes).toBeNull()
  })

  it('returns null for a non-existent contract', async () => {
    const updated = await updateInstitutionContract('00000000-0000-0000-0000-000000000000', { seatsPurchased: 10 })
    expect(updated).toBeNull()
  })
})

describe('deleteInstitutionContract', () => {
  it('deletes the row and returns true', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    const contract = await makeContract(institution.id, teacher.id)

    expect(await deleteInstitutionContract(contract.id)).toBe(true)
    expect(await listInstitutionContracts(institution.id)).toHaveLength(0)
  })

  it('returns false for a non-existent contract', async () => {
    expect(await deleteInstitutionContract('00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})

describe('institution_contracts constraints', () => {
  it('rejects a term where end is not after start', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    await expect(makeContract(institution.id, teacher.id, { termStart: '2026-06-01', termEnd: '2026-01-01' }))
      .rejects.toThrow()
  })

  it('rejects zero or negative seats', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    await expect(makeContract(institution.id, teacher.id, { seatsPurchased: 0 })).rejects.toThrow()
  })

  it('cascades delete when the institution is removed', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher()
    await makeContract(institution.id, teacher.id)

    await pool.query('DELETE FROM institutions WHERE id = $1', [institution.id])
    expect(await listInstitutionContracts(institution.id)).toHaveLength(0)
  })
})
