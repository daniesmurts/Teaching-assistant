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
import { createTestTeacher } from '../db/__tests__/fixtures'
import { createInstitution } from '../db/queries/institutions'
import { getRootUnitForInstitution, addUnitRole } from '../db/queries/orgUnits'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function setupInstitutionTeacher(planTier = 'institution') {
  const institution = await createInstitution({ name: `Test Inst ${Date.now()}`, planTier, maxTeachers: null })
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET plan_tier = $2 WHERE id = $1', [teacher.id, planTier])
  const root = await getRootUnitForInstitution(institution.id)
  if (!root) throw new Error('root unit missing')
  const token = signToken({ id: teacher.id, email: teacher.email })
  return { institution, teacher, root, token }
}

describe('curriculum-domain access (Research.md §7.10 Phase 1)', () => {
  it('a curriculum/edit grant at root reaches RPD monitor and institution criteria/rubrics', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'edit', 'curriculum')

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Authorization', `Bearer ${token}`)
    expect(rpd.status).toBe(200)

    const criteria = await request(app).get('/api/institution/criteria').set('Authorization', `Bearer ${token}`)
    expect(criteria.status).toBe(200)

    const rubrics = await request(app).get('/api/institution/rubrics').set('Authorization', `Bearer ${token}`)
    expect(rubrics.status).toBe(200)
  })

  it('a curriculum/edit grant does NOT reach platform-only institution routes', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'edit', 'curriculum')

    const teachers = await request(app).get('/api/institution/teachers').set('Authorization', `Bearer ${token}`)
    expect(teachers.status).toBe(403)

    const audit = await request(app).get('/api/institution/audit').set('Authorization', `Bearer ${token}`)
    expect(audit.status).toBe(403)
  })

  it('a curriculum/view grant can read but not write criteria', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'curriculum')

    const read = await request(app).get('/api/institution/criteria').set('Authorization', `Bearer ${token}`)
    expect(read.status).toBe(200)

    const write = await request(app).post('/api/institution/criteria').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test criterion' })
    expect(write.status).toBe(403)
  })

  it('a teacher with no grant is refused on curriculum-gated routes', async () => {
    const { token } = await setupInstitutionTeacher()

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Authorization', `Bearer ${token}`)
    expect(rpd.status).toBe(403)

    const criteria = await request(app).get('/api/institution/criteria').set('Authorization', `Bearer ${token}`)
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

    const teachers = await request(app).get('/api/institution/teachers').set('Authorization', `Bearer ${token}`)
    expect(teachers.status).toBe(403)

    // But it does still satisfy requireDomain('curriculum', 'edit') — admin
    // outranks edit within the domain it was actually granted on.
    const criteria = await request(app).get('/api/institution/criteria').set('Authorization', `Bearer ${token}`)
    expect(criteria.status).toBe(200)
  })

  it('a true institution-root admin (domain=all) is unaffected — reaches everything', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'admin', 'all')

    const teachers = await request(app).get('/api/institution/teachers').set('Authorization', `Bearer ${token}`)
    expect(teachers.status).toBe(200)

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Authorization', `Bearer ${token}`)
    expect(rpd.status).toBe(200)
  })

  it('the grant-role validation refuses an admin-level grant scoped to a non-all domain', async () => {
    const { teacher: admin, root, token } = await setupInstitutionTeacher()
    await addUnitRole(admin.id, root.id, 'admin', 'all')
    const other = await createTestTeacher({ institutionId: root.institution_id })

    const res = await request(app).post('/api/institution/structure/roles').set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
    expect(overview.status).toBe(403)
  })

  it('a teaching/view grant at root reaches leadership + institution read surfaces', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'teaching')

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(leadership.status).toBe(200)

    const overview = await request(app).get('/api/institution/overview').set('Authorization', `Bearer ${token}`)
    expect(overview.status).toBe(200)

    const usage = await request(app).get('/api/institution/usage/daily').set('Authorization', `Bearer ${token}`)
    expect(usage.status).toBe(200)

    const teachers = await request(app).get('/api/institution/teachers').set('Authorization', `Bearer ${token}`)
    expect(teachers.status).toBe(200)
  })

  it('a teaching/view grant does NOT reach teacher mutation, curriculum, or platform routes', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'view', 'teaching')
    const other = await createTestTeacher({ institutionId: root.institution_id })

    const patch = await request(app).patch(`/api/institution/teachers/${other.id}`)
      .set('Authorization', `Bearer ${token}`).send({ isActive: false })
    expect(patch.status).toBe(403)

    const rpd = await request(app).get('/api/institution/rpd/overview').set('Authorization', `Bearer ${token}`)
    expect(rpd.status).toBe(403)

    const audit = await request(app).get('/api/institution/audit').set('Authorization', `Bearer ${token}`)
    expect(audit.status).toBe(403)
  })

  it('a teacher with no grant is refused on teaching-gated routes', async () => {
    const { root, token } = await setupInstitutionTeacher()

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(leadership.status).toBe(403)

    const overview = await request(app).get('/api/institution/overview').set('Authorization', `Bearer ${token}`)
    expect(overview.status).toBe(403)
  })

  it('a true institution-root admin (domain=all) is unaffected — still reaches leadership', async () => {
    const { teacher, root, token } = await setupInstitutionTeacher()
    await addUnitRole(teacher.id, root.id, 'admin', 'all')

    const leadership = await request(app).get(`/api/leadership/overview?unitId=${root.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(leadership.status).toBe(200)
  })
})
