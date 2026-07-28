// РОП Студия v0 (TODO.md Feature Z, Phase 0) — HTTP-level coverage for the
// three new market-evidence endpoints on the existing programs router.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { signToken } from '../lib/jwt'
import { SESSION_COOKIE_NAME } from '../lib/session'
import { createTestTeacher, createTestInstitution } from '../db/__tests__/fixtures'
import { createProgram } from '../db/queries/programs'
import { createFgosStandardDraft } from '../db/queries/fgos'

vi.mock('../services/labourMarket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/labourMarket')>()
  return {
    ...actual,
    fetchVacancySnapshot: vi.fn().mockResolvedValue({
      fetched_at: '2026-07-22T20:00:00.000Z',
      regions: [{
        region_code: '1600000000000', region_name: 'Республика Татарстан',
        by_profession: [{ term: 'инженер-технолог', total: 86, sample: [
          { title: 'Инженер-технолог', employer: 'АО «ТАИФ-НК»', salary: 'от 85000', url: 'https://x', date: '2026-06-17' },
        ] }],
      }],
    }),
  }
})
vi.mock('../services/marketEvidenceGenerator', () => ({
  generateMarketEvidenceSection: vi.fn().mockResolvedValue({
    text: 'По состоянию на 22.07.2026 в Республике Татарстан зафиксировано 86 вакансий по профессии «инженер-технолог».',
  }),
}))
// Plane-2 retrieval (routes/programs.ts's findStrategyExcerpts) embeds a
// query string via services/deepseek's embed — fixed to a known vector so
// tests can control cosine distance against seeded institution_strategy_chunks
// rows deterministically (same vector twice = distance 0). Other services
// mounted by app.ts (e.g. policyMemo.ts) import chatJSON from the same
// module, so this must spread importOriginal rather than replace it wholesale.
// 256-dim, not 1536 — Yandex's text-search-doc model (migration 024), what
// every embedding column in this schema actually stores.
const { STRATEGY_QUERY_VECTOR } = vi.hoisted(() => ({ STRATEGY_QUERY_VECTOR: new Array(256).fill(0.01) }))
vi.mock('../services/deepseek', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/deepseek')>()
  return { ...actual, embed: vi.fn().mockResolvedValue(STRATEGY_QUERY_VECTOR) }
})

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function platformAdminSetup() {
  const institution = await createTestInstitution({})
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [teacher.id])
  const { token } = signToken({ id: teacher.id, email: teacher.email })

  await createFgosStandardDraft({
    standard: { direction_code: '15.03.02', level: 'бакалавриат', title: 'Технологические машины и оборудование', generation: '3++' },
    competencies: [],
    structureRequirements: [],
    profstandardRefs: [{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства', source_url: null }],
  }, teacher.id)

  const program = await createProgram(institution.id, teacher.id, {
    name: 'Технологические машины и оборудование', code: '15.03.02', level: 'bachelor', duration_semesters: 8,
  })

  return { teacher, token, program, institution }
}

// Regression for the 2026-07-24 finding: programmes imported from a sveden.ru
// disclosure page only ever get `education_level` (free text) populated —
// `level` (the enum PROGRAM_LEVEL_TO_FGOS_LEVEL maps) is never set by that
// path, so every real imported programme hit "не указан уровень
// образования" even though the РОП had genuinely filled in «Уровень
// образования» at import time.
async function platformAdminSetupNoLevelEnum() {
  const institution = await createTestInstitution({})
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [teacher.id])
  const { token } = signToken({ id: teacher.id, email: teacher.email })

  await createFgosStandardDraft({
    standard: { direction_code: '15.03.02', level: 'бакалавриат', title: 'Технологические машины и оборудование', generation: '3++' },
    competencies: [],
    structureRequirements: [],
    profstandardRefs: [{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства', source_url: null }],
  }, teacher.id)

  const program = await createProgram(institution.id, teacher.id, {
    name: 'Технологические машины и оборудование', code: '15.03.02', duration_semesters: 8,
    education_level: 'Высшее образование — бакалавриат',
  })

  return { teacher, token, program, institution }
}

describe('market evidence — generate, read, edit', () => {
  it('POST generates and persists evidence using real profstandard refs from the ФГОС registry', async () => {
    const { token, program } = await platformAdminSetup()

    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    expect(res.status).toBe(201)
    expect(res.body.section_text).toContain('86 вакансий')
    expect(res.body.profstandard_refs).toEqual([{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства' }])
    expect(res.body.region_names).toEqual(['Республика Татарстан'])
  })

  it('GET returns the latest generated evidence', async () => {
    const { token, program } = await platformAdminSetup()
    await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(200)
    expect(res.body.section_text).toContain('86 вакансий')
  })

  it('GET returns null when nothing has been generated yet', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('PUT edits only section_text, leaving the snapshot fields untouched', async () => {
    const { token, program } = await platformAdminSetup()
    const create = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    const put = await request(app).put(`/api/institution/programs/${program.id}/market-evidence/${create.body.id}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ section_text: 'Отредактированный РОПом текст.' })

    expect(put.status).toBe(200)
    expect(put.body.section_text).toBe('Отредактированный РОПом текст.')
    expect(put.body.region_names).toEqual(create.body.region_names)
    expect(put.body.profstandard_refs).toEqual(create.body.profstandard_refs)
  })

  it('generates successfully when only education_level (free text) is set, not the level enum', async () => {
    const { token, program } = await platformAdminSetupNoLevelEnum()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    expect(res.status).toBe(201)
    expect(res.body.profstandard_refs).toEqual([{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства' }])
  })

  it('rejects generation with an unknown region code', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['0000000000000'], professions: ['инженер'] })
    expect(res.status).toBe(400)
  })

  it('rejects generation with no regions selected', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: [], professions: ['инженер'] })
    expect(res.status).toBe(400)
  })

  it('rejects generation with no profession terms', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['1600000000000'], professions: [] })
    expect(res.status).toBe(400)
  })

  it('accepts a request naming multiple region codes (validation passes both through to fetchVacancySnapshot)', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
      .send({ region_codes: ['1600000000000', '7700000000000'], professions: ['инженер-технолог'] })
    // The mocked fetchVacancySnapshot always returns a fixed single-region
    // snapshot regardless of input — this test's job is only to confirm the
    // route accepts >1 region code without a validation error; the stored
    // region_codes reflect whatever fetchVacancySnapshot actually returned.
    expect(res.status).toBe(201)
    expect(res.body.region_codes).toEqual(['1600000000000'])
  })

  it('a teacher with no program access is refused', async () => {
    const { program } = await platformAdminSetup()
    const outsider = await createTestTeacher({})
    const { token } = signToken({ id: outsider.id, email: outsider.email })
    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM')
    expect(res.status).toBe(403)
  })

  it('leaves strategy_excerpts empty when the institution has no strategy document', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })
    expect(res.status).toBe(201)
    expect(res.body.strategy_excerpts).toEqual([])
  })

  it('includes a strategy excerpt (Plane-2) when the institution has a closely-matching document chunk', async () => {
    const { token, program, institution } = await platformAdminSetup()

    const { rows } = await pool.query(
      `INSERT INTO institution_strategy_documents (institution_id, file_name, storage_path, processing_status)
       VALUES ($1, 'strategy.pdf', 'x', 'ready') RETURNING id`,
      [institution.id]
    )
    await pool.query(
      `INSERT INTO institution_strategy_chunks (document_id, chunk_index, text, embedding, page_start, page_end)
       VALUES ($1, 0, 'Приоритет — развитие инженерных кадров региона.', $2, 4, 4)`,
      [rows[0].id, `[${STRATEGY_QUERY_VECTOR.join(',')}]`]
    )

    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`).set('X-Requested-With', 'ISPUM').send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    expect(res.status).toBe(201)
    expect(res.body.strategy_excerpts).toEqual([
      { text: 'Приоритет — развитие инженерных кадров региона.', page_start: 4, page_end: 4 },
    ])
  })
})
