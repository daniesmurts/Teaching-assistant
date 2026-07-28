// Feature Z Plane-2 pilot completion — HTTP-level coverage for the new
// institution-admin-only strategy-document endpoints (routes/institution.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { signToken } from '../lib/jwt'
import { SESSION_COOKIE_NAME } from '../lib/session'
import { createTestTeacher, createTestInstitution } from '../db/__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function institutionAdminSetup() {
  const institution = await createTestInstitution({})
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [teacher.id])
  const { token } = signToken({ id: teacher.id, email: teacher.email })
  return { institution, teacher, token }
}

describe('institution strategy document (Feature Z Plane-2)', () => {
  it('GET returns null when nothing has been uploaded', async () => {
    const { token } = await institutionAdminSetup()
    const res = await request(app).get('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('POST uploads a document and GET reflects it', async () => {
    const { token } = await institutionAdminSetup()

    const post = await request(app).post('/api/institution/strategy-document')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .attach('file', Buffer.from('stub pdf bytes'), { filename: 'strategy.pdf', contentType: 'application/pdf' })
    expect(post.status).toBe(201)
    expect(post.body.file_name).toBe('strategy.pdf')
    expect(['pending', 'extracting', 'chunking', 'ready', 'failed']).toContain(post.body.processing_status)

    const get = await request(app).get('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(get.status).toBe(200)
    expect(get.body.file_name).toBe('strategy.pdf')
  })

  it('a second upload replaces the first (one document per institution)', async () => {
    const { token } = await institutionAdminSetup()

    await request(app).post('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .attach('file', Buffer.from('first'), { filename: 'first.pdf', contentType: 'application/pdf' })
    await request(app).post('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .attach('file', Buffer.from('second'), { filename: 'second.pdf', contentType: 'application/pdf' })

    const get = await request(app).get('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(get.body.file_name).toBe('second.pdf')
  })

  it('DELETE removes the document', async () => {
    const { token } = await institutionAdminSetup()
    await request(app).post('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .attach('file', Buffer.from('stub'), { filename: 'strategy.pdf', contentType: 'application/pdf' })

    const del = await request(app).delete('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(del.status).toBe(204)

    const get = await request(app).get('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(get.body).toBeNull()
  })

  it('a non-admin teacher of the same institution is refused', async () => {
    const { institution } = await institutionAdminSetup()
    const teacher = await createTestTeacher({ institutionId: institution.id })
    const { token } = signToken({ id: teacher.id, email: teacher.email })

    const res = await request(app).get('/api/institution/strategy-document').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(403)
  })
})
