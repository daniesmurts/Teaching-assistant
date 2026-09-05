import { describe, it, expect } from 'vitest'
import { normaliseInviteNames, INVITE_NAME_MAX } from './inviteNames'

describe('normaliseInviteNames', () => {
  it('keeps the teacher order and casing', () => {
    expect(normaliseInviteNames(['Иванов И.И.', 'Петрова А.С.'])).toEqual(['Иванов И.И.', 'Петрова А.С.'])
  })

  it('drops blank lines from a pasted list', () => {
    expect(normaliseInviteNames(['Иванов', '', '   ', 'Петров'])).toEqual(['Иванов', 'Петров'])
  })

  it('drops a student repeated in the paste', () => {
    // Two links for one student is two submissions to reconcile later.
    expect(normaliseInviteNames(['Иванов И.', 'Петров', 'иванов и.'])).toEqual(['Иванов И.', 'Петров'])
  })

  it('collapses the double spaces a copied table leaves behind', () => {
    expect(normaliseInviteNames(['Иванов   И.  И.'])).toEqual(['Иванов И. И.'])
    // …and that collapsing is what makes the dedupe actually catch this pair.
    expect(normaliseInviteNames(['Иванов И.', 'Иванов  И.'])).toEqual(['Иванов И.'])
  })

  it('truncates an absurdly long line rather than rejecting the whole paste', () => {
    expect(normaliseInviteNames(['и'.repeat(500)])[0].length).toBe(INVITE_NAME_MAX)
  })

  it('ignores non-strings and non-arrays', () => {
    expect(normaliseInviteNames([1, null, {}, 'Иванов'])).toEqual(['Иванов'])
    expect(normaliseInviteNames('Иванов')).toEqual([])
    expect(normaliseInviteNames(null)).toEqual([])
  })
})
