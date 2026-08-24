import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import http from 'node:http'
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose'
import { app } from '../app'
import { pool } from '../db/connection'
import { createLaunchState } from '../services/lti'
import { setLtiConfig } from '../db/queries/institutions'
import { createTestInstitution, createTestTeacher, createTestCourse } from '../db/__tests__/fixtures'
import { createPublishedAssignment } from '../db/queries/publishedAssignments'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

// ─── Test IdP: a real RS256 keypair + a local JWKS HTTP server ────────────────
// Unlike SAML's XML-DSig signing, LTI's JWT-based launch is fully testable
// end-to-end — `jose` both signs (playing the platform) and verifies (our
// actual services/lti.ts code, unmodified) here.

let jwksServer: http.Server
let jwksUrl: string
let privateKey: KeyLike

const ISSUER      = 'https://moodle.test-university.ru'
const CLIENT_ID   = 'test-client-id'
const DEPLOYMENT  = 'test-deployment-1'

beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair('RS256')
  privateKey = priv
  const jwk = await exportJWK(publicKey)

  jwksServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'test-platform-key', use: 'sig', alg: 'RS256' }] }))
  })
  await new Promise<void>((resolve) => jwksServer.listen(0, resolve))
  const addr = jwksServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  jwksUrl = `http://127.0.0.1:${port}/jwks`
})

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()))
})

async function setupLtiInstitution(overrides?: { deploymentIds?: string[] }) {
  const institution = await createTestInstitution()
  await setLtiConfig(institution.id, {
    lti_enabled:                 true,
    lti_platform_issuer:         ISSUER,
    lti_platform_client_id:      CLIENT_ID,
    lti_platform_deployment_ids: overrides?.deploymentIds ?? [DEPLOYMENT],
    lti_platform_auth_login_url: 'https://moodle.test-university.ru/mod/lti/auth.php',
    lti_platform_jwks_url:       jwksUrl,
  })
  return institution
}

async function signLaunchToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-platform-key' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

const CLAIM = {
  deploymentId: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  context:      'https://purl.imsglobal.org/spec/lti/claim/context',
  roles:        'https://purl.imsglobal.org/spec/lti/claim/roles',
  messageType:  'https://purl.imsglobal.org/spec/lti/claim/message_type',
  deepLinkingSettings: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  ags:          'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
}

const INSTRUCTOR_ROLE = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'
const LEARNER_ROLE    = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'

function instructorClaims(opts: { nonce: string; email?: string; contextId?: string }) {
  return {
    sub:   'platform-user-1',
    email: opts.email ?? 'teacher@test-university.ru',
    name:  'Test Teacher',
    nonce: opts.nonce,
    [CLAIM.messageType]:  'LtiResourceLinkRequest',
    [CLAIM.deploymentId]: DEPLOYMENT,
    [CLAIM.roles]:        [INSTRUCTOR_ROLE],
    [CLAIM.context]:      { id: opts.contextId ?? 'moodle-course-1', title: 'Test Course', label: 'TC101' },
  }
}

describe('POST /api/lti/launch — instructor resource-link happy path', () => {
  it('creates a teacher, auto-creates a course, sets the session cookie, and redirects to /lti/callback', async () => {
    const institution = await setupLtiInstitution()
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce }))

    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/lti/callback')
    expect(res.headers.location).toMatch(/courseId=/)
    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    expect(cookies.some((c) => c.startsWith('ispum_session='))).toBe(true)

    const { rows } = await pool.query('SELECT * FROM teachers WHERE email = $1', ['teacher@test-university.ru'])
    expect(rows[0]).toBeTruthy()
    expect(rows[0].institution_id).toBe(institution.id)
    expect(rows[0].lti_subject).toBe('platform-user-1')
  })

  it('records a success row in lti_launch_log', async () => {
    const institution = await setupLtiInstitution()
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce, email: 'logged@test-university.ru' }))

    await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })

    const { rows } = await pool.query(
      `SELECT l.* FROM lti_launch_log l
         JOIN teachers t ON t.id = l.teacher_id
        WHERE t.email = $1`,
      ['logged@test-university.ru']
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].success).toBe(true)
    expect(rows[0].role).toBe('instructor')
  })
})

describe('POST /api/lti/launch — rejections', () => {
  it('LTI_STATE_INVALID for an unknown/expired/replayed state', async () => {
    await setupLtiInstitution()
    const idToken = await signLaunchToken(instructorClaims({ nonce: 'whatever' }))
    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state: 'no-such-state' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('LTI_STATE_INVALID')
  })

  it('LTI_NOT_CONFIGURED when the institution has no LTI config', async () => {
    const institution = await createTestInstitution()
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce }))
    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('LTI_NOT_CONFIGURED')
  })

  it('LTI_NONCE_MISMATCH when the token nonce does not match the launch state', async () => {
    const institution = await setupLtiInstitution()
    const { state } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce: 'wrong-nonce' }))
    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('LTI_NONCE_MISMATCH')
  })

  it('LTI_DEPLOYMENT_UNKNOWN when the token deployment_id is not registered for the institution', async () => {
    const institution = await setupLtiInstitution({ deploymentIds: ['some-other-deployment'] })
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce }))
    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('LTI_DEPLOYMENT_UNKNOWN')
  })

  it('records a failure row in lti_launch_log with the error code', async () => {
    const institution = await setupLtiInstitution()
    const { state } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken(instructorClaims({ nonce: 'wrong-nonce' }))
    await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })

    const { rows } = await pool.query(
      `SELECT * FROM lti_launch_log WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [institution.id]
    )
    expect(rows[0].success).toBe(false)
    expect(rows[0].error_code).toBe('LTI_NONCE_MISMATCH')
  })
})

describe('POST /api/lti/launch — Deep Linking', () => {
  it('creates a deep-link session and redirects to /lti/deep-link for an instructor', async () => {
    const institution = await setupLtiInstitution()
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken({
      ...instructorClaims({ nonce, email: 'dl-teacher@test-university.ru' }),
      [CLAIM.messageType]: 'LtiDeepLinkingRequest',
      [CLAIM.deepLinkingSettings]: { deep_link_return_url: 'https://moodle.test-university.ru/return' },
    })

    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/lti/deep-link')
    expect(res.headers.location).toMatch(/session=/)
  })
})

describe('POST /api/lti/launch — co-taught course support (regression test)', () => {
  it('two different teachers launching the same Moodle context each get their own course', async () => {
    const institution = await setupLtiInstitution()
    const contextId = 'shared-moodle-course'

    const { state: state1, nonce: nonce1 } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const token1 = await signLaunchToken(instructorClaims({ nonce: nonce1, email: 'teacher-a@test-university.ru', contextId }))
    const res1 = await request(app).post('/api/lti/launch').type('form').send({ id_token: token1, state: state1 })
    const courseId1 = new URL(res1.headers.location, 'http://x').searchParams.get('courseId')

    const { state: state2, nonce: nonce2 } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const token2 = await signLaunchToken(instructorClaims({ nonce: nonce2, email: 'teacher-b@test-university.ru', contextId }))
    const res2 = await request(app).post('/api/lti/launch').type('form').send({ id_token: token2, state: state2 })
    const courseId2 = new URL(res2.headers.location, 'http://x').searchParams.get('courseId')

    expect(courseId1).toBeTruthy()
    expect(courseId2).toBeTruthy()
    expect(courseId1).not.toBe(courseId2)

    const { rows: teacherA } = await pool.query('SELECT id FROM teachers WHERE email = $1', ['teacher-a@test-university.ru'])
    const { rows: teacherB } = await pool.query('SELECT id FROM teachers WHERE email = $1', ['teacher-b@test-university.ru'])
    const { rows: courseARows } = await pool.query('SELECT teacher_id FROM courses WHERE id = $1', [courseId1])
    const { rows: courseBRows } = await pool.query('SELECT teacher_id FROM courses WHERE id = $1', [courseId2])
    expect(courseARows[0].teacher_id).toBe(teacherA[0].id)
    expect(courseBRows[0].teacher_id).toBe(teacherB[0].id)

    // Same teacher launching again reuses their own course, doesn't create a third.
    const { state: state3, nonce: nonce3 } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const token3 = await signLaunchToken(instructorClaims({ nonce: nonce3, email: 'teacher-a@test-university.ru', contextId }))
    const res3 = await request(app).post('/api/lti/launch').type('form').send({ id_token: token3, state: state3 })
    const courseId3 = new URL(res3.headers.location, 'http://x').searchParams.get('courseId')
    expect(courseId3).toBe(courseId1)
  })

  it('the AGS lineitem for a student launch resolves to the correct co-teacher via the published assignment, not the ambiguous context', async () => {
    const institution = await setupLtiInstitution()
    const contextId = 'shared-moodle-course-2'

    // Teacher A launches first, deep-links an activity (creates a published assignment on their own course).
    const teacherA = await createTestTeacher({ institutionId: institution.id })
    const courseA  = await createTestCourse(teacherA.id)
    const pa = await createPublishedAssignment({ teacherId: teacherA.id, courseId: courseA.id, title: 'Assignment A' })

    // Manually create the lti_course_links row the way resolveCourseForLtiLaunch would have.
    await pool.query(
      `INSERT INTO lti_course_links (institution_id, deployment_id, context_id, course_id, teacher_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [institution.id, DEPLOYMENT, contextId, courseA.id, teacherA.id]
    )
    // Teacher B also has a link for the SAME context (co-teacher) — this is
    // exactly the ambiguity a context_id-only lookup can't resolve.
    const teacherB = await createTestTeacher({ institutionId: institution.id })
    const courseB  = await createTestCourse(teacherB.id)
    await pool.query(
      `INSERT INTO lti_course_links (institution_id, deployment_id, context_id, course_id, teacher_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [institution.id, DEPLOYMENT, contextId, courseB.id, teacherB.id]
    )

    // A student launches teacher A's published assignment.
    const { state, nonce } = await createLaunchState({ institutionId: institution.id, targetLinkUri: null })
    const idToken = await signLaunchToken({
      sub: 'student-1', email: 'student@test-university.ru', name: 'Test Student', nonce,
      [CLAIM.messageType]:  'LtiResourceLinkRequest',
      [CLAIM.deploymentId]: DEPLOYMENT,
      [CLAIM.roles]:        [LEARNER_ROLE],
      [CLAIM.context]:      { id: contextId, title: 'Test Course' },
      [CLAIM.ags]:          { lineitem: 'https://moodle.test-university.ru/lineitem/1', scope: [] },
      'https://purl.imsglobal.org/spec/lti/claim/custom': { published_assignment_id: pa.id },
    })

    const res = await request(app).post('/api/lti/launch').type('form').send({ id_token: idToken, state })
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/student/')

    const { rows } = await pool.query(
      `SELECT lcl.course_id FROM lti_line_items li
         JOIN lti_course_links lcl ON lcl.id = li.lti_course_link_id
        WHERE li.published_assignment_id = $1`,
      [pa.id]
    )
    expect(rows).toHaveLength(1)
    // Must resolve to teacher A's course (the one the published assignment
    // actually belongs to), not whichever row a context_id-only LIMIT 1 picks.
    expect(rows[0].course_id).toBe(courseA.id)
  })
})
