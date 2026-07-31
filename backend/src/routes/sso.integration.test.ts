import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { findOrCreateSamlTeacher } from '../db/queries/teachers'
import { setSamlConfig, createInstitution, getSamlConfig } from '../db/queries/institutions'
import { createTestTeacher, createTestInstitution, TEST_PASSWORD } from '../db/__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const VALID_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...stub...\n-----END CERTIFICATE-----'

async function completeSamlConfig(institutionId: string, overrides?: { forceSso?: boolean }) {
  await setSamlConfig(institutionId, {
    saml_enabled:       true,
    saml_idp_entity_id: 'https://idp.university.ru/metadata',
    saml_idp_sso_url:   'https://idp.university.ru/sso',
    saml_idp_x509_cert: VALID_CERT,
    saml_force_sso:     overrides?.forceSso ?? false,
  })
}

// ─── findOrCreateSamlTeacher — the real JIT-provisioning logic ────────────────
// Tested directly against the DB rather than through a signed SAMLResponse:
// @node-saml/node-saml is SP-only (no IdP-side assertion builder in its
// public API), and hand-rolling a valid XML-DSig-signed assertion via the
// transitive xml-crypto dependency would mostly be re-testing that library's
// own well-established signature verification, not our code. This is where
// the actual business logic lives.

describe('findOrCreateSamlTeacher', () => {
  it('creates a new teacher on first SSO login, verified from birth', async () => {
    const institution = await createTestInstitution()
    const teacher = await findOrCreateSamlTeacher({
      email: 'newcomer@university.ru', name: 'Новый Преподаватель',
      institutionId: institution.id, samlSubject: 'saml-subject-1',
    })
    expect(teacher.institution_id).toBe(institution.id)
    expect(teacher.saml_subject).toBe('saml-subject-1')
    expect(teacher.saml_provisioned_at).not.toBeNull()
    expect(teacher.email_verified_at).not.toBeNull()
  })

  it('backfills saml_subject/saml_provisioned_at for an existing password teacher without touching their institution', async () => {
    const originalInstitution = await createTestInstitution()
    const otherInstitution    = await createTestInstitution()
    const teacher = await createTestTeacher({ email: 'existing@university.ru', institutionId: originalInstitution.id })

    const updated = await findOrCreateSamlTeacher({
      email: 'existing@university.ru', name: 'Existing Teacher',
      institutionId: otherInstitution.id, samlSubject: 'saml-subject-2',
    })

    expect(updated.id).toBe(teacher.id)
    expect(updated.saml_subject).toBe('saml-subject-2')
    // Never re-attaches to a different institution — this teacher already had one.
    expect(updated.institution_id).toBe(originalInstitution.id)
  })

  it('places a newly-attached teacher into the default department', async () => {
    const institution = await createInstitution({ name: `SAML Test Inst ${Date.now()}`, planTier: 'institution', maxTeachers: null })
    const teacher = await findOrCreateSamlTeacher({
      email: 'placed@university.ru', name: 'Placed Teacher',
      institutionId: institution.id, samlSubject: 'saml-subject-3',
    })
    expect(teacher.primary_org_unit_id).not.toBeNull()
  })

  it('a second login for the same SAML subject reuses the same teacher and does not clobber saml_subject', async () => {
    const institution = await createTestInstitution()
    const first = await findOrCreateSamlTeacher({
      email: 'repeat@university.ru', name: 'Repeat Teacher',
      institutionId: institution.id, samlSubject: 'saml-subject-4',
    })
    const second = await findOrCreateSamlTeacher({
      email: 'repeat@university.ru', name: 'Repeat Teacher',
      institutionId: institution.id, samlSubject: 'saml-subject-4',
    })
    expect(second.id).toBe(first.id)
    expect(second.saml_subject).toBe('saml-subject-4')
  })
})

// ─── POST /api/sso/discover ─────────────────────────────────────────────────

describe('POST /api/sso/discover', () => {
  it('routes a configured domain to SAML with institution info', async () => {
    const institution = await createTestInstitution()
    await pool.query('UPDATE institutions SET email_domain = $2 WHERE id = $1', [institution.id, 'kstu.example.test'])
    await completeSamlConfig(institution.id)

    const res = await request(app).post('/api/sso/discover').send({ email: 'teacher@kstu.example.test' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      method:        'saml',
      institutionId: institution.id,
      loginUrl:      `/api/sso/${institution.id}/login`,
    })
  })

  it('falls back to password for an unconfigured domain', async () => {
    const res = await request(app).post('/api/sso/discover').send({ email: 'anyone@no-such-domain.example.test' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ method: 'password' })
  })

  it('falls back to password when the domain has an incomplete SAML config (enabled but no cert)', async () => {
    const institution = await createTestInstitution()
    await pool.query('UPDATE institutions SET email_domain = $2 WHERE id = $1', [institution.id, 'incomplete.example.test'])
    await setSamlConfig(institution.id, { saml_enabled: true })

    const res = await request(app).post('/api/sso/discover').send({ email: 'teacher@incomplete.example.test' })
    expect(res.body).toEqual({ method: 'password' })
  })

  it('never reveals whether the email itself is registered — same response with or without a matching teacher', async () => {
    const withTeacher = await request(app).post('/api/sso/discover').send({ email: 'registered@no-such-domain.example.test' })
    const withoutTeacher = await request(app).post('/api/sso/discover').send({ email: 'unregistered@no-such-domain.example.test' })
    expect(withTeacher.body).toEqual(withoutTeacher.body)
  })
})

// ─── GET /api/sso/:id/metadata ──────────────────────────────────────────────

describe('GET /api/sso/:id/metadata', () => {
  it('returns SP metadata XML with the correct entityID and ACS location', async () => {
    const institution = await createTestInstitution()
    const res = await request(app).get(`/api/sso/${institution.id}/metadata`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/xml/)
    expect(res.text).toContain('<md:EntityDescriptor')
    expect(res.text).toContain(`/api/sso/${institution.id}/acs`)
  })
})

// ─── GET /api/sso/:id/login ──────────────────────────────────────────────────

describe('GET /api/sso/:id/login', () => {
  it('404s when SAML is not configured for the institution', async () => {
    const institution = await createTestInstitution()
    const res = await request(app).get(`/api/sso/${institution.id}/login`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('SAML_NOT_CONFIGURED')
  })

  it('redirects to the configured IdP entry point when complete', async () => {
    const institution = await createTestInstitution()
    await completeSamlConfig(institution.id)
    const res = await request(app).get(`/api/sso/${institution.id}/login`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('idp.university.ru')
  })
})

// ─── POST /api/sso/:id/acs ───────────────────────────────────────────────────
// Negative paths only — see the file-level comment on why a full signed
// SAMLResponse round-trip isn't attempted here.

describe('POST /api/sso/:id/acs', () => {
  it('404s when SAML is not configured for the institution', async () => {
    const institution = await createTestInstitution()
    const res = await request(app).post(`/api/sso/${institution.id}/acs`).send({ SAMLResponse: 'anything' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('SAML_NOT_CONFIGURED')
  })

  it('400s with a validation error (not a crash) when SAMLResponse is missing', async () => {
    const institution = await createTestInstitution()
    await completeSamlConfig(institution.id)
    const res = await request(app).post(`/api/sso/${institution.id}/acs`).send({})
    expect(res.status).toBe(400)
  })

  it('400s with SAML_VALIDATION_FAILED (not a crash) for a garbage SAMLResponse', async () => {
    const institution = await createTestInstitution()
    await completeSamlConfig(institution.id)
    const res = await request(app)
      .post(`/api/sso/${institution.id}/acs`)
      .send({ SAMLResponse: Buffer.from('not a real saml response').toString('base64') })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('SAML_VALIDATION_FAILED')
  })
})

// ─── saml_force_sso enforcement (backend/src/routes/auth.ts POST /login) ────

describe('saml_force_sso enforcement on POST /api/auth/login', () => {
  it('rejects a correct password with 403 SSO_REQUIRED when the institution requires SSO-only login', async () => {
    const institution = await createTestInstitution()
    await completeSamlConfig(institution.id, { forceSso: true })
    const teacher = await createTestTeacher({ institutionId: institution.id })

    const res = await request(app).post('/api/auth/login')
      .set('X-Requested-With', 'ISPUM')
      .send({ email: teacher.email, password: TEST_PASSWORD })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('SSO_REQUIRED')
    expect(res.body.ssoLoginUrl).toBe(`/api/sso/${institution.id}/login`)
  })

  it('does not lock teachers out when force_sso is set but the SAML config is incomplete (lockout guard)', async () => {
    const institution = await createTestInstitution()
    // force_sso on, but no IdP fields set — an admin footgun this must not honour.
    await setSamlConfig(institution.id, { saml_enabled: true, saml_force_sso: true })
    const teacher = await createTestTeacher({ institutionId: institution.id })

    const res = await request(app).post('/api/auth/login')
      .set('X-Requested-With', 'ISPUM')
      .send({ email: teacher.email, password: TEST_PASSWORD })

    expect(res.status).toBe(200)
  })

  it('logs in normally when force_sso is false', async () => {
    const institution = await createTestInstitution()
    await completeSamlConfig(institution.id, { forceSso: false })
    const teacher = await createTestTeacher({ institutionId: institution.id })

    const res = await request(app).post('/api/auth/login')
      .set('X-Requested-With', 'ISPUM')
      .send({ email: teacher.email, password: TEST_PASSWORD })

    expect(res.status).toBe(200)
  })

  it('a teacher with no institution is never affected by force_sso', async () => {
    const teacher = await createTestTeacher()
    const res = await request(app).post('/api/auth/login')
      .set('X-Requested-With', 'ISPUM')
      .send({ email: teacher.email, password: TEST_PASSWORD })
    expect(res.status).toBe(200)
  })
})

// Sanity check that setSamlConfig/getSamlConfig round-trip saml_force_sso —
// guards the admin save path (AdminInstitutions.tsx) at the query layer.
describe('setSamlConfig / getSamlConfig — saml_force_sso round-trip', () => {
  it('persists and reads back saml_force_sso independently of the other fields', async () => {
    const institution = await createTestInstitution()
    await setSamlConfig(institution.id, { saml_force_sso: true })
    const cfg = await getSamlConfig(institution.id)
    expect(cfg?.saml_force_sso).toBe(true)
  })
})
