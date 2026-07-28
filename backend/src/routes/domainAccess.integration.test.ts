// HTTP-level coverage for Research.md §7.10 Phase 1: a teacher holding only a
// domain='curriculum' grant (not institution-root admin) must reach the
// curriculum-gated routes (RPD monitor, institution criteria/rubrics) and
// must still be refused on routes that stayed requireInstitutionAdmin-gated.
// Also guards the privilege-escalation case this phase introduced risk for:
// isInstitutionAdmin must never treat a domain-scoped admin grant as root admin.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { signToken } from '../lib/jwt'
import { SESSION_COOKIE_NAME } from '../lib/session'
import { createTestTeacher } from '../db/__tests__/fixtures'
import { createInstitution } from '../db/queries/institutions'
import { getRootUnitForInstitution, addUnitRole, createOrgUnit, setPrimaryOrgUnit } from '../db/queries/orgUnits'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function setupInstitutionTeacher(planTier = 'institution') {
  const institution = await createInstitution({ name: `Test Inst ${Date.now()}`, planTier, maxTeachers: null })
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [teacher.id, planTier])
  const root = await getRootUnitForInstitution(institution.id)
  if (!root) throw new Error('root unit missing')
  const { token } = signToken({ id: teacher.id, email: teacher.email })
  return { institution, teacher, root, token }
}

describe('curriculum-domain access (Research.md §7.10 Phase 1)', () => {
  it('a curriculum/edit grant at root reaches RPD monitor and institution criteria/rubrics', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'edit', 'curriculum')

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(rpd.status).toBe(200)

    const criteria = await request(app).get('/api/institution/criteria').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(criteria.status).toBe(200)

    const rubrics = await request(app).get('/api/institution/rubrics').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(rubrics.status).toBe(200)
  })

  it('a curriculum/edit grant does NOT reach platform-only institution routes', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'edit', 'curriculum')

    const teachers = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(teachers.status).toBe(403)

    const audit = await request(app).get('/api/institution/audit').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(audit.status).toBe(403)
  })

  it('a curriculum/view grant can read but not write criteria', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'curriculum')

    const read = await request(app).get('/api/institution/criteria').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(read.status).toBe(200)

    const write = await request(app).post('/api/institution/criteria').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ name: 'Test criterion' })
    expect(write.status).toBe(403)
  })

  it('a teacher with no grant is refused on curriculum-gated routes', async () => {
    const { token } = await setupInstitutionTeacher()

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(rpd.status).toBe(403)

    const criteria = await request(app).get('/api/institution/criteria').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(criteria.status).toBe(403)
  })

  it("a domain='curriculum' admin-level grant is NOT treated as institution-root admin", async () => {
    // Belt-and-suspenders regression: isInstitutionAdmin must require
    // domain='all', not just role='admin' — otherwise a curriculum-scoped
    // admin grant would silently unlock the entire institution admin panel.
    const { teacher, root, token } = await setupInstitutionTeacher()
    await pool.query(
      `INSERT INTO org_unit_roles (teacher_id, org_unit_id, role, domain) VALUES ($1, $2, 'admin', 'curriculum')`,
      [teacher.id, root.id]
    )

    const teachers = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(teachers.status).toBe(403)

    // But it does still satisfy requireDomain('curriculum', 'edit') — admin
    // outranks edit within the domain it was actually granted on.
    const criteria = await request(app).get('/api/institution/criteria').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(criteria.status).toBe(200)
  })

  it('a true institution-root admin (domain=all) is unaffected — reaches everything', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'admin', 'all')

    const teachers = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(teachers.status).toBe(200)

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(rpd.status).toBe(200)
  })

  it('the grant-role validation refuses an admin-level grant scoped to a non-all domain', async () => {
    const { teacher: admin, root, token } = await setupInstitutionTeacher()
    await addUnitRole(admin.id, root.id, 'admin', 'all')
    const other = await createTestTeacher({ institutionId: root.institution_id })

    const res = await request(app).post('/api/institution/structure/roles').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ teacherId: other.id, unitId: root.id, role: 'admin', domain: 'curriculum' })
    expect(res.status).toBe(400)
  })
})

describe('teaching-domain access (Research.md §7.10 Phase 2)', () => {
  it('REGRESSION: a curriculum-domain grant does NOT leak into the leadership dashboard', async () => {
    // Found while scoping Phase 2: teacherCanActOnUnit/hasLeadershipRole
    // predate the domain axis and matched on role alone, so a Phase 1
    // curriculum grant (role='edit') already satisfied their role-only check
    // and reached grading activity + rosters it was never meant to see.
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'edit', 'curriculum')

    const overview = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(overview.status).toBe(403)
  })

  it('a teaching/view grant at root reaches leadership + institution read surfaces', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'teaching')

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(leadership.status).toBe(200)

    const overview = await request(app).get('/api/institution/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(overview.status).toBe(200)

    const usage = await request(app).get('/api/institution/usage/daily').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(usage.status).toBe(200)

    const teachers = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(teachers.status).toBe(200)
  })

  it('a teaching/view grant does NOT reach teacher mutation, curriculum, or platform routes', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'teaching')
    const other = await createTestTeacher({ institutionId: root.institution_id })

    const patch = await request(app).patch(`/api/institution/teachers/${other.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ isActive: false })
    expect(patch.status).toBe(403)

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(rpd.status).toBe(403)

    const audit = await request(app).get('/api/institution/audit').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(audit.status).toBe(403)
  })

  it('a teacher with no grant is refused on teaching-gated routes', async () => {
    const { root, token } = await setupInstitutionTeacher()

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(leadership.status).toBe(403)

    const overview = await request(app).get('/api/institution/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(overview.status).toBe(403)
  })

  it('a true institution-root admin (domain=all) is unaffected — still reaches leadership', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'admin', 'all')

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(leadership.status).toBe(200)
  })
})

describe('subtree query scoping (Research.md §7.10 Phase 3)', () => {
  it('a teaching/view grant on a SUB-UNIT only sees teachers/activity in that subtree', async () => {
    const { institution, root } = await setupInstitutionTeacher()

    const division = await createOrgUnit({
      institutionId: institution.id, parentId: root.id, typeCode: 'division', name: 'Test Division',
    })
    const outsideDept = await createOrgUnit({
      institutionId: institution.id, parentId: root.id, typeCode: 'department', name: 'Outside Dept',
    })

    const insideTeacher  = await createTestTeacher({ institutionId: institution.id })
    const outsideTeacher = await createTestTeacher({ institutionId: institution.id })
    await setPrimaryOrgUnit(insideTeacher.id, division.id)
    await setPrimaryOrgUnit(outsideTeacher.id, outsideDept.id)

    const viewer = await createTestTeacher({ institutionId: institution.id })
    await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [viewer.id, 'institution'])
    await addUnitRole(viewer.id, division.id, 'view', 'teaching')
    const { token: viewerToken } = signToken({ id: viewer.id, email: viewer.email })

    const res = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${viewerToken}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(200)
    const ids = res.body.map((t: { id: string }) => t.id)
    expect(ids).toContain(insideTeacher.id)
    expect(ids).not.toContain(outsideTeacher.id)

    const overview = await request(app).get('/api/institution/overview').set('Cookie', `${SESSION_COOKIE_NAME}=${viewerToken}`).set('X-Requested-With', 'ISPUM')
    expect(overview.status).toBe(200)
    expect(overview.body.totalTeachers).toBe(1)
  })

  it('a ROOT-anchored teaching/view grant is unrestricted — regression guard against the subtlety', async () => {
    // If the root-path check in resolveTeachingPrefixes were removed, this
    // would incorrectly drop any teacher with no primary_org_unit_id from an
    // otherwise-unrestricted root grant's view.
    const { institution, root } = await setupInstitutionTeacher()

    const grantee = await createTestTeacher({ institutionId: institution.id })
    await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [grantee.id, 'institution'])
    await addUnitRole(grantee.id, root.id, 'view', 'teaching')
    const { token: granteeToken } = signToken({ id: grantee.id, email: grantee.email })

    // A teacher with NO primary unit assigned — must still be visible under
    // an unrestricted (root-anchored) grant.
    const orphan = await createTestTeacher({ institutionId: institution.id })

    const res = await request(app).get('/api/institution/teachers').set('Cookie', `${SESSION_COOKIE_NAME}=${granteeToken}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(200)
    const ids = res.body.map((t: { id: string }) => t.id)
    expect(ids).toContain(orphan.id)
  })
})

describe('subtree-scoped org tree CRUD + role grants (Research.md §7.10 Phase 3 slice B)', () => {
  async function setupDivisionAdmin() {
    const { institution, root } = await setupInstitutionTeacher()
    const division = await createOrgUnit({
      institutionId: institution.id, parentId: root.id, typeCode: 'division', name: 'Институт Х',
    })
    const outside = await createOrgUnit({
      institutionId: institution.id, parentId: root.id, typeCode: 'department', name: 'Кафедра снаружи',
    })
    const director = await createTestTeacher({ institutionId: institution.id })
    await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [director.id, 'institution'])
    await addUnitRole(director.id, division.id, 'admin', 'all')
    const { token } = signToken({ id: director.id, email: director.email })
    return { institution, root, division, outside, director, token }
  }

  it('creates, renames, and deletes a unit WITHIN the granted subtree', async () => {
    const { division, token } = await setupDivisionAdmin()

    const create = await request(app).post('/api/institution/structure/units').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ parentId: division.id, typeCode: 'department', name: 'Кафедра внутри' })
    expect(create.status).toBe(201)
    const kafedraId = create.body.id

    const rename = await request(app).patch(`/api/institution/structure/units/${kafedraId}`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ name: 'Кафедра внутри (переим.)' })
    expect(rename.status).toBe(200)

    const del = await request(app).delete(`/api/institution/structure/units/${kafedraId}`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(del.status).toBe(204)
  })

  it('is REFUSED (403) creating/renaming/deleting a unit OUTSIDE the granted subtree', async () => {
    const { root, outside, token } = await setupDivisionAdmin()

    const createUnderOutside = await request(app).post('/api/institution/structure/units').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ parentId: outside.id, typeCode: 'department', name: 'Не должно создаться' })
    expect(createUnderOutside.status).toBe(403)

    const renameOutside = await request(app).patch(`/api/institution/structure/units/${outside.id}`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ name: 'Переименовано без прав' })
    expect(renameOutside.status).toBe(403)

    const deleteRoot = await request(app).delete(`/api/institution/structure/units/${root.id}`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(deleteRoot.status).toBe(403)
  })

  it('refuses moving a unit OUT of scope, and refuses pulling one IN from outside scope', async () => {
    const { division, outside, token } = await setupDivisionAdmin()

    const create = await request(app).post('/api/institution/structure/units').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ parentId: division.id, typeCode: 'department', name: 'Кафедра внутри' })
    const kafedraId = create.body.id

    // Move the in-scope kafedra to the out-of-scope department — refused
    // (new parent is out of scope).
    const moveOut = await request(app).post(`/api/institution/structure/units/${kafedraId}/move`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ newParentId: outside.id })
    expect(moveOut.status).toBe(403)

    // Move the out-of-scope department into the division — refused (the
    // unit being moved is out of scope).
    const moveIn = await request(app).post(`/api/institution/structure/units/${outside.id}/move`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ newParentId: division.id })
    expect(moveIn.status).toBe(403)
  })

  it('grants and revokes a role WITHIN the subtree; refused OUTSIDE it', async () => {
    const { institution, division, outside, token } = await setupDivisionAdmin()
    const teacher = await createTestTeacher({ institutionId: institution.id })

    const grant = await request(app).post('/api/institution/structure/roles').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ teacherId: teacher.id, unitId: division.id, role: 'edit', domain: 'curriculum' })
    expect(grant.status).toBe(201)

    const revoke = await request(app).delete('/api/institution/structure/roles').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ teacherId: teacher.id, unitId: division.id, role: 'edit', domain: 'curriculum' })
    expect(revoke.status).toBe(200)

    const grantOutside = await request(app).post('/api/institution/structure/roles').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ teacherId: teacher.id, unitId: outside.id, role: 'edit', domain: 'curriculum' })
    expect(grantOutside.status).toBe(403)
  })

  it('GET / and GET /members return only the granted subtree', async () => {
    const { institution, division, outside, token } = await setupDivisionAdmin()
    const insideTeacher  = await createTestTeacher({ institutionId: institution.id })
    const outsideTeacher = await createTestTeacher({ institutionId: institution.id })
    await setPrimaryOrgUnit(insideTeacher.id, division.id)
    await setPrimaryOrgUnit(outsideTeacher.id, outside.id)

    const tree = await request(app).get('/api/institution/structure').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(tree.status).toBe(200)
    const unitIds = tree.body.units.map((u: { id: string }) => u.id)
    expect(unitIds).toContain(division.id)
    expect(unitIds).not.toContain(outside.id)

    const members = await request(app).get('/api/institution/structure/members').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(members.status).toBe(200)
    const memberIds = members.body.members.map((m: { id: string }) => m.id)
    expect(memberIds).toContain(insideTeacher.id)
    expect(memberIds).not.toContain(outsideTeacher.id)
  })

  it('PUT /members/:teacherId/primary stays 403 for a sub-unit admin (explicit exclusion)', async () => {
    const { institution, division, token } = await setupDivisionAdmin()
    const someTeacher = await createTestTeacher({ institutionId: institution.id })

    const res = await request(app).put(`/api/institution/structure/members/${someTeacher.id}/primary`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ unitId: division.id })
    expect(res.status).toBe(403)
  })

  it('a true root admin (domain=all at root) is unaffected — reaches everything unchanged', async () => {
    const { institution, root } = await setupInstitutionTeacher()
    const admin = await createTestTeacher({ institutionId: institution.id })
    await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [admin.id, 'institution'])
    await addUnitRole(admin.id, root.id, 'admin', 'all')
    const { token: adminToken } = signToken({ id: admin.id, email: admin.email })

    const create = await request(app).post('/api/institution/structure/units').set('Cookie', `${SESSION_COOKIE_NAME}=${adminToken}`).set('X-Requested-With', 'ISPUM')
      .send({ parentId: root.id, typeCode: 'division', name: 'Новый институт' })
    expect(create.status).toBe(201)

    const tree = await request(app).get('/api/institution/structure').set('Cookie', `${SESSION_COOKIE_NAME}=${adminToken}`).set('X-Requested-With', 'ISPUM')
    expect(tree.status).toBe(200)
    expect(tree.body.units.length).toBeGreaterThanOrEqual(2) // root + newly created
  })
})
