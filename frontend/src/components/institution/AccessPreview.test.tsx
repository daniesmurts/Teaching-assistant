import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { GrantEffectPreview, MemberAccessPanel, toHeldGrants, pendingGrant } from './AccessPreview'
import type { OrgUnit, InstitutionMember } from '../../api/orgStructure'
import type { HeldGrant } from '../../../../shared/accessCatalog'

// The two surfaces exist to stop an admin guessing what a
// (подразделение × роль × область) combination does. What matters is not that
// they render, but that they say the right thing about the combinations that
// actually confused people: the kafedra head who expected Мониторинг РПД, and
// the grant that quietly adds nothing because a broader role already covers it.

// vitest runs with `globals: false`, so Testing Library's automatic afterEach
// cleanup never registers.
afterEach(cleanup)

const unit = (id: string, type: OrgUnit['type_code'], name: string): OrgUnit => ({
  id, institution_id: 'i1', parent_id: null, type_code: type, name, short_name: null,
  external_code: null, path: `/${id}`, member_count: 0, created_at: '', code: null,
  specialty_name: null, education_level: null, forms_of_study: null,
})

const KAFEDRA = unit('d1', 'department', 'Кафедра ХТ')
const UMC     = unit('a1', 'admin_office', 'УМЦ')
const ROOT    = unit('r1', 'institution', 'КНИТУ')
const UNITS   = new Map([KAFEDRA, UMC, ROOT].map((u) => [u.id, u]))

const roles = (...rs: InstitutionMember['roles']): HeldGrant[] => toHeldGrants(rs, UNITS)

describe('GrantEffectPreview', () => {
  it('names what a kafedra curriculum:edit grant opens — and that РПД is not it', () => {
    render(<GrantEffectPreview existing={[]} pending={pendingGrant(KAFEDRA, 'edit', 'curriculum')} />)
    expect(screen.getByText(/Критерии и рубрики — создание/)).toBeTruthy()
    expect(screen.queryByText(/Мониторинг РПД — просмотр/)).toBeNull()
  })

  it('explains a near miss instead of silently omitting it', () => {
    render(<GrantEffectPreview existing={[]} pending={pendingGrant(UMC, 'view', 'umu')} />)
    fireEvent.click(screen.getByRole('button', { name: /Не откроет/ }))
    expect(screen.getByText(/Мониторинг РПД — загрузка и письма — нужен более высокий уровень роли/)).toBeTruthy()
  })

  it('says outright when the new grant adds nothing over the existing ones', () => {
    const existing = roles({ org_unit_id: 'r1', role: 'admin', domain: 'all' })
    render(<GrantEffectPreview existing={existing} pending={pendingGrant(UMC, 'edit', 'umu')} />)
    expect(screen.getByText(/Ничего нового/)).toBeTruthy()
  })

  it('always states what no role can delegate', () => {
    render(<GrantEffectPreview existing={[]} pending={pendingGrant(KAFEDRA, 'edit', 'teaching')} />)
    expect(screen.getByText(/Приглашение и деактивация преподавателей/)).toBeTruthy()
  })
})

describe('MemberAccessPanel', () => {
  it('groups a Заведующий кафедрой bundle and scopes it to their kafedra', () => {
    render(<MemberAccessPanel grants={roles(
      { org_unit_id: 'd1', role: 'admin', domain: 'teaching' },
      { org_unit_id: 'd1', role: 'edit',  domain: 'curriculum' },
    )} />)
    expect(screen.getByText(/Критерии и рубрики — создание/)).toBeTruthy()
    expect(screen.getAllByText(/Кафедра ХТ/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Готовность УМК/)).toBeNull()
  })

  it('lists closed features with the reason on demand', () => {
    render(<MemberAccessPanel grants={roles({ org_unit_id: 'd1', role: 'edit', domain: 'curriculum' })} />)
    fireEvent.click(screen.getByRole('button', { name: /Закрыто/ }))
    expect(screen.getByText(/Журнал действий — только администратор организации/)).toBeTruthy()
  })

  it('flags an institution-root admin as organisation-wide', () => {
    render(<MemberAccessPanel grants={roles({ org_unit_id: 'r1', role: 'admin', domain: 'all' })} />)
    expect(screen.getByText(/Администратор организации — полный доступ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Закрыто/ })).toBeNull()
  })

  it('tells a teacher with no grants what they still have', () => {
    render(<MemberAccessPanel grants={[]} />)
    expect(screen.getByText(/Ролей нет/)).toBeTruthy()
  })
})
