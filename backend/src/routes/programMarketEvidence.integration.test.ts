// РОП Студия v0 (TODO.md Feature Z, Phase 0) — HTTP-level coverage for the
// three new market-evidence endpoints on the existing programs router.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { signToken } from '../lib/jwt'
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

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function platformAdminSetup() {
  const institution = await createTestInstitution({})
  const teacher = await createTestTeacher({ institutionId: institution.id })
  await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [teacher.id])
  const token = signToken({ id: teacher.id, email: teacher.email })

  await createFgosStandardDraft({
    standard: { direction_code: '15.03.02', level: 'бакалавриат', title: 'Технологические машины и оборудование', generation: '3++' },
    competencies: [],
    structureRequirements: [],
    profstandardRefs: [{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства', source_url: null }],
  }, teacher.id)

  const program = await createProgram(institution.id, teacher.id, {
    name: 'Технологические машины и оборудование', code: '15.03.02', level: 'bachelor', duration_semesters: 8,
  })

  return { teacher, token, program }
}

describe('market evidence — generate, read, edit', () => {
  it('POST generates and persists evidence using real profstandard refs from the ФГОС registry', async () => {
    const { token, program } = await platformAdminSetup()

    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    expect(res.status).toBe(201)
    expect(res.body.section_text).toContain('86 вакансий')
    expect(res.body.profstandard_refs).toEqual([{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства' }])
    expect(res.body.region_names).toEqual(['Республика Татарстан'])
  })

  it('GET returns the latest generated evidence', async () => {
    const { token, program } = await platformAdminSetup()
    await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`).send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.section_text).toContain('86 вакансий')
  })

  it('GET returns null when nothing has been generated yet', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('PUT edits only section_text, leaving the snapshot fields untouched', async () => {
    const { token, program } = await platformAdminSetup()
    const create = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`).send({ region_codes: ['1600000000000'], professions: ['инженер-технолог'] })

    const put = await request(app).put(`/api/institution/programs/${program.id}/market-evidence/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`).send({ section_text: 'Отредактированный РОПом текст.' })

    expect(put.status).toBe(200)
    expect(put.body.section_text).toBe('Отредактированный РОПом текст.')
    expect(put.body.region_names).toEqual(create.body.region_names)
    expect(put.body.profstandard_refs).toEqual(create.body.profstandard_refs)
  })

  it('rejects generation with an unknown region code', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`).send({ region_codes: ['0000000000000'], professions: ['инженер'] })
    expect(res.status).toBe(400)
  })

  it('rejects generation with no regions selected', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`).send({ region_codes: [], professions: ['инженер'] })
    expect(res.status).toBe(400)
  })

  it('rejects generation with no profession terms', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`).send({ region_codes: ['1600000000000'], professions: [] })
    expect(res.status).toBe(400)
  })

  it('accepts a request naming multiple region codes (validation passes both through to fetchVacancySnapshot)', async () => {
    const { token, program } = await platformAdminSetup()
    const res = await request(app).post(`/api/institution/programs/${program.id}/market-evidence`)
      .set('Authorization', `Bearer ${token}`)
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
    const token = signToken({ id: outsider.id, email: outsider.email })
    const res = await request(app).get(`/api/institution/programs/${program.id}/market-evidence`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})
