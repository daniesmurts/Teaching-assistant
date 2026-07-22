// Regression test for the fix in db/__tests__/transactionalTestIsolation.ts
// (see that file for the full story — found while verifying Feature AA v1,
// 2026-07-22). No second DB connection needed: this test manually ends the
// outer transaction mid-test (the same thing `afterEach` does) and checks
// the row's TRUE committed state. Without the fix, a pool.connect()-based
// transactional helper's inner COMMIT would already have made the row
// permanently committed — this ROLLBACK would do nothing, and the row would
// still be there. With the fix, the inner "COMMIT" was only ever a savepoint
// release, so this ROLLBACK correctly undoes everything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from './connection'
import { createInstitution } from './queries/institutions'
import { getRootUnitForInstitution, createOrgUnit } from './queries/orgUnits'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('transactional test isolation (pool.connect()-based helpers)', () => {
  it('a createOrgUnit call is truly rolled back, not silently committed', async () => {
    const institution = await createInstitution({ name: `Rollback Probe ${Date.now()}`, planTier: 'institution', maxTeachers: null })
    const root = await getRootUnitForInstitution(institution.id)
    if (!root) throw new Error('root unit missing')

    const created = await createOrgUnit({
      institutionId: institution.id, parentId: root.id, typeCode: 'department', name: 'Rollback Probe Dept',
    })

    // End the transaction early, exactly like afterEach will — but check the
    // row's real state NOW, within this test, before this file's own
    // afterEach fires again (which would just be a harmless no-op ROLLBACK
    // on an already-closed transaction).
    await pool.query('ROLLBACK')

    const { rows: unitRows } = await pool.query('SELECT id FROM org_units WHERE id = $1', [created.id])
    expect(unitRows).toHaveLength(0)
    const { rows: instRows } = await pool.query('SELECT id FROM institutions WHERE id = $1', [institution.id])
    expect(instRows).toHaveLength(0)

    // Leave a transaction open so this file's own afterEach: ROLLBACK
    // doesn't error on a connection with no open transaction.
    await pool.query('BEGIN')
  })
})
