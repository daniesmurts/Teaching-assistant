// HTTP-level coverage for Feature AA v1 (TODO.md "### AA"): platform-wide
// ФГОС registry, requireAdmin-only (never institution admin — this is
// federal reference data, not institution data), and the two-step
// extract (no DB write) → create draft → publish (confirm) flow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { signToken } from '../lib/jwt'
import { createTestTeacher } from '../db/__tests__/fixtures'
import { createInstitution } from '../db/queries/institutions'
import { addUnitRole, getRootUnitForInstitution } from '../db/queries/orgUnits'

vi.mock('../services/documentExtractor', () => ({
  extractText: vi.fn().mockResolvedValue({ text: 'stub ФГОС text, long enough to pass the length check.......', method: 'docx' }),
}))
vi.mock('../services/fgosExtractor', () => ({
  extractFgosDraft: vi.fn().mockResolvedValue({
    standard: { direction_code: '09.03.04', level: 'бакалавриат', title: 'Программная инженерия', generation: '3++', order_number: null, order_date: null, effective_date: null },
    competencies: [{ type: 'УК', code: 'УК-1', formulation: 'Тестовая формулировка.', is_verbatim_verified: true }],
    structureRequirements: [{ block_label: 'Блок 1', min_credits: 180, max_credits: 200, notes: null }],
    profstandardRefs: [{ code: '06.001', name: 'Программист', source_url: null }],
  }),
}))

const TOP_PAGE_HTML = `
<title>ФГОС ВО (3++) по направлениям бакалавриата</title>
<div class="item d-flex" data-key="29"><div class="w112 text-green align-middle"><span class="icons openbook align-middle me-2"></span>020000</div>
<div>
    <a class="item-link" href="/fgosvo/index/24/29" data-pjax="0">КОМПЬЮТЕРНЫЕ И ИНФОРМАЦИОННЫЕ НАУКИ</a></div>
</div>`

const CATEGORY_PAGE_HTML = `
<div class="item d-flex" data-key="1583">    <div class="d-flex">
        <div class="w80 me-2">02.03.01</div>
        <div>
            <div><span class="icons googledocs align-middle"></span>Математика и компьютерные науки</div>
                            <div class="text-darkgrey">
                    <a class="text-darkgrey" href="/fgosvo/downloads?f=%2Fuploadfiles%2FFGOS+VO+3%2B%2B%2FBak%2F020301_B_3_15062021.pdf&amp;id=1583" data-pjax="0" target="_blank">PDF, 176.57 КБ</a><span>, 15.01.2022</span>
                                    </div>
                                </div>
    </div>
</div>`

vi.mock('../services/documentFetch', () => ({
  fetchPageHtml: vi.fn(async (url: string) => {
    if (url.includes('/index/24/29')) return { html: CATEGORY_PAGE_HTML, finalUrl: url }
    return { html: TOP_PAGE_HTML, finalUrl: url }
  }),
  fetchDocumentFromUrl: vi.fn().mockResolvedValue({
    buffer: Buffer.from('stub pdf bytes'), originalname: 'fgos.pdf', mimetype: 'application/pdf', size: 14,
  }),
}))

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function platformAdminToken() {
  const teacher = await createTestTeacher({})
  await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [teacher.id])
  return { teacher, token: signToken({ id: teacher.id, email: teacher.email }) }
}

async function institutionAdminToken() {
  const institution = await createInstitution({ name: `Test Inst ${Date.now()}`, planTier: 'institution', maxTeachers: null })
  const teacher = await createTestTeacher({ institutionId: institution.id })
  const root = await getRootUnitForInstitution(institution.id)
  if (!root) throw new Error('root missing')
  await addUnitRole(teacher.id, root.id, 'admin', 'all')
  return signToken({ id: teacher.id, email: teacher.email })
}

const VALID_PAYLOAD = {
  standard: { direction_code: '09.03.04', level: 'бакалавриат', title: 'Программная инженерия', generation: '3++' },
  competencies: [{ type: 'УК', code: 'УК-1', formulation: 'Тестовая формулировка.', is_verbatim_verified: true }],
  structureRequirements: [{ block_label: 'Блок 1', min_credits: 180, max_credits: 200, notes: null }],
  profstandardRefs: [{ code: '06.001', name: 'Программист', source_url: null }],
}

describe('ФГОС registry — requireAdmin gate (Feature AA v1)', () => {
  it('refuses an institution admin (this is platform-wide reference data, not institution data)', async () => {
    const token = await institutionAdminToken()
    const res = await request(app).get('/api/admin/fgos').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('a teacher with no admin flag at all is refused', async () => {
    const teacher = await createTestTeacher({})
    const token = signToken({ id: teacher.id, email: teacher.email })
    const res = await request(app).get('/api/admin/fgos').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('a platform admin reaches the registry', async () => {
    const { token } = await platformAdminToken()
    const res = await request(app).get('/api/admin/fgos').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

describe('ФГОС registry — extract → create → publish round trip', () => {
  it('extract does NOT write to the DB', async () => {
    const { token } = await platformAdminToken()

    // Count delta rather than asserting the table is empty: the shared
    // integration test DB is not a clean slate (a separate, pre-existing
    // issue — see the note left in TODO.md), so only the *change* caused
    // by this test's own /extract call is a meaningful assertion here.
    const before = await request(app).get('/api/admin/fgos').set('Authorization', `Bearer ${token}`)
    const countBefore = before.body.standards.length

    const extract = await request(app).post('/api/admin/fgos/extract').set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not a real pdf, just bytes'), { filename: 'fgos.pdf', contentType: 'application/pdf' })
    expect(extract.status).toBe(200)
    expect(extract.body.standard.direction_code).toBe('09.03.04')

    const after = await request(app).get('/api/admin/fgos').set('Authorization', `Bearer ${token}`)
    expect(after.body.standards.length).toBe(countBefore)
  })

  it('create persists as draft; publish flips status and is what GET returns with children', async () => {
    const { token } = await platformAdminToken()

    const create = await request(app).post('/api/admin/fgos').set('Authorization', `Bearer ${token}`).send(VALID_PAYLOAD)
    expect(create.status).toBe(201)
    expect(create.body.status).toBe('draft')
    const id = create.body.id

    const beforePublish = await request(app).get(`/api/admin/fgos/${id}`).set('Authorization', `Bearer ${token}`)
    expect(beforePublish.body.status).toBe('draft')
    expect(beforePublish.body.competencies).toHaveLength(1)

    const publish = await request(app).post(`/api/admin/fgos/${id}/publish`).set('Authorization', `Bearer ${token}`).send(VALID_PAYLOAD)
    expect(publish.status).toBe(200)
    expect(publish.body.status).toBe('published')

    const afterPublish = await request(app).get(`/api/admin/fgos/${id}`).set('Authorization', `Bearer ${token}`)
    expect(afterPublish.body.status).toBe('published')
    expect(afterPublish.body.competencies).toHaveLength(1)
    expect(afterPublish.body.structure_requirements).toHaveLength(1)
    expect(afterPublish.body.profstandard_refs).toHaveLength(1)
  })

  it('publish rejects a payload missing required standard fields', async () => {
    const { token } = await platformAdminToken()
    const create = await request(app).post('/api/admin/fgos').set('Authorization', `Bearer ${token}`).send(VALID_PAYLOAD)
    const id = create.body.id

    const res = await request(app).post(`/api/admin/fgos/${id}/publish`).set('Authorization', `Bearer ${token}`)
      .send({ standard: { direction_code: '', level: '', title: '' }, competencies: [], structureRequirements: [], profstandardRefs: [] })
    expect(res.status).toBe(400)
  })

  it('delete removes the standard (and cascades children)', async () => {
    const { token } = await platformAdminToken()
    const create = await request(app).post('/api/admin/fgos').set('Authorization', `Bearer ${token}`).send(VALID_PAYLOAD)
    const id = create.body.id

    const del = await request(app).delete(`/api/admin/fgos/${id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)

    const get = await request(app).get(`/api/admin/fgos/${id}`).set('Authorization', `Bearer ${token}`)
    expect(get.status).toBe(404)
  })
})

describe('ФГОС registry — bulk import from fgosvo.ru', () => {
  it('requireAdmin gate: an institution admin is refused on /discover', async () => {
    const token = await institutionAdminToken()
    const res = await request(app).post('/api/admin/fgos/discover').set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://fgosvo.ru/fgosvo/index/24' })
    expect(res.status).toBe(403)
  })

  it('discover crawls the top page and every category, returning a combined checklist', async () => {
    const { token } = await platformAdminToken()
    const res = await request(app).post('/api/admin/fgos/discover').set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://fgosvo.ru/fgosvo/index/24' })

    expect(res.status).toBe(200)
    expect(res.body.level).toBe('бакалавриат')
    expect(res.body.categories_scanned).toBe(1)
    expect(res.body.categories_failed).toEqual([])
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      code: '02.03.01', name: 'Математика и компьютерные науки', level: 'бакалавриат',
      category: 'КОМПЬЮТЕРНЫЕ И ИНФОРМАЦИОННЫЕ НАУКИ', already_imported: false,
    })
  })

  it('discover marks an already-registered direction_code+level as already_imported', async () => {
    const { token } = await platformAdminToken()
    await request(app).post('/api/admin/fgos').set('Authorization', `Bearer ${token}`).send({
      ...VALID_PAYLOAD,
      standard: { ...VALID_PAYLOAD.standard, direction_code: '02.03.01', level: 'бакалавриат' },
    })

    const res = await request(app).post('/api/admin/fgos/discover').set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://fgosvo.ru/fgosvo/index/24' })
    expect(res.body.items[0].already_imported).toBe(true)
  })

  it('import-one fetches, extracts, and lands the standard as a draft (never published)', async () => {
    const { token } = await platformAdminToken()
    const res = await request(app).post('/api/admin/fgos/import-one').set('Authorization', `Bearer ${token}`).send({
      code: '02.03.01', name: 'Математика и компьютерные науки', level: 'бакалавриат',
      pdf_url: 'https://fgosvo.ru/fgosvo/downloads?f=x&id=1583',
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('draft')
    expect(res.body.direction_code).toBe('02.03.01')
    expect(res.body.source_url).toBe('https://fgosvo.ru/fgosvo/downloads?f=x&id=1583')

    const get = await request(app).get(`/api/admin/fgos/${res.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(get.body.competencies).toHaveLength(1)
  })

  it('import-one rejects a request missing required fields', async () => {
    const { token } = await platformAdminToken()
    const res = await request(app).post('/api/admin/fgos/import-one').set('Authorization', `Bearer ${token}`)
      .send({ code: '02.03.01' })
    expect(res.status).toBe(400)
  })
})
