import { describe, it, expect } from 'vitest'
import {
  compareStudentNames, groupsCompatible, nameCompleteness,
  normaliseStudentName, studentsCompatible, suggestStudentMerges,
} from '../../../shared/studentIdentity'

const entry = (student_name: string, student_group: string | null, submissions = 1, last = '2026-09-07') =>
  ({ student_name, student_group, submissions, last_submission: last })

describe('normaliseStudentName', () => {
  it('folds the ways one ФИО gets typed', () => {
    expect(normaliseStudentName('Алтышев Н.И')).toBe('алтышев н и')
    expect(normaliseStudentName('  АЛТЫШЕВ   Н. И.  ')).toBe('алтышев н и')
    expect(normaliseStudentName('Алёхин П.')).toBe('алехин п')
  })
})

describe('compareStudentNames', () => {
  it('expands initials against the full form', () => {
    expect(compareStudentNames('Алтышев Н.И', 'Алтышев Назар Игоревич')).toBe('compatible')
  })

  it('calls punctuation-only differences identical', () => {
    expect(compareStudentNames('Алтышев Н.И', 'Алтышев Н. И.')).toBe('identical')
  })

  it('matches a bare surname against a full name', () => {
    expect(compareStudentNames('Алтышев', 'Алтышев Назар Игоревич')).toBe('compatible')
  })

  it('refuses when an initial contradicts the full name', () => {
    expect(compareStudentNames('Алтышев Н.И', 'Алтышев Пётр Игоревич')).toBe('different')
    // patronymic, not just the given name
    expect(compareStudentNames('Алтышев Н.И', 'Алтышев Назар Петрович')).toBe('different')
  })

  it('refuses two different full given names', () => {
    expect(compareStudentNames('Алтышев Назар Игоревич', 'Алтышев Никита Игоревич')).toBe('different')
  })

  it('never matches across surnames — gender endings included', () => {
    expect(compareStudentNames('Иванов И.И.', 'Петров И.И.')).toBe('different')
    // Иванов/Иванова are two people until a teacher merges them by hand.
    expect(compareStudentNames('Иванов И.', 'Иванова И.')).toBe('different')
  })

  it('treats an empty name as unmatchable', () => {
    expect(compareStudentNames('', 'Алтышев Н.И')).toBe('different')
  })
})

describe('groupsCompatible', () => {
  it('accepts a missing group on either side', () => {
    expect(groupsCompatible(null, '251-МО21')).toBe(true)
    expect(groupsCompatible('251-МО21', null)).toBe(true)
  })

  it('ignores punctuation and case in the group code', () => {
    expect(groupsCompatible('251-МО21', '251 мо21')).toBe(true)
  })

  it('rejects two explicit, different groups', () => {
    // The one case where the same abbreviation really is two students.
    expect(groupsCompatible('251-МО21', '252-МО21')).toBe(false)
    expect(studentsCompatible(
      { student_name: 'Алтышев Н.И', student_group: '251-МО21' },
      { student_name: 'Алтышев Назар Игоревич', student_group: '252-МО21' },
    )).toBe(false)
  })
})

describe('nameCompleteness', () => {
  it('counts only spelled-out tokens', () => {
    expect(nameCompleteness('Алтышев Назар Игоревич')).toBe(3)
    expect(nameCompleteness('Алтышев Н.И')).toBe(1)
  })
})

describe('suggestStudentMerges', () => {
  it('proposes the fuller spelling as the target', () => {
    const out = suggestStudentMerges([
      entry('Алтышев Н.И', null, 1, '2026-09-07'),
      entry('Алтышев Назар Игоревич', '251-МО21', 1, '2026-09-07'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].target).toEqual({ student_name: 'Алтышев Назар Игоревич', student_group: '251-МО21' })
    expect(out[0].sources).toEqual([{ student_name: 'Алтышев Н.И', student_group: null }])
    expect(out[0].submissions).toBe(2)
    expect(out[0].confidence).toBe('medium')   // group known on one side only
  })

  it('rolls a three-way split into one suggestion', () => {
    const out = suggestStudentMerges([
      entry('Алтышев Н.И', '251-МО21'),
      entry('Алтышев Н. И.', '251-МО21'),
      entry('Алтышев Назар Игоревич', '251-МО21'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sources).toHaveLength(2)
    expect(out[0].confidence).toBe('high')     // same explicit group throughout
  })

  it('withholds a cluster the short form makes ambiguous', () => {
    // «Алтышев Н.И» fits both full names and there is no honest way to pick.
    expect(suggestStudentMerges([
      entry('Алтышев Н.И', null),
      entry('Алтышев Назар Игоревич', null),
      entry('Алтышев Никита Иванович', null),
    ])).toEqual([])
  })

  it('scores a bare-surname match as low rather than dropping it', () => {
    const out = suggestStudentMerges([
      entry('Алтышев', null),
      entry('Алтышев Назар Игоревич', '251-МО21'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].confidence).toBe('low')
  })

  it('leaves a clean roster alone', () => {
    expect(suggestStudentMerges([
      entry('Алтышев Назар Игоревич', '251-МО21'),
      entry('Петрова Анна Сергеевна', '251-МО21'),
    ])).toEqual([])
  })

  it('does not pair namesakes in different groups', () => {
    expect(suggestStudentMerges([
      entry('Алтышев Н.И', '251-МО21'),
      entry('Алтышев Назар Игоревич', '252-МО21'),
    ])).toEqual([])
  })

  it('ranks confident suggestions first', () => {
    const out = suggestStudentMerges([
      entry('Алтышев', null),
      entry('Алтышев Назар Игоревич', '251-МО21'),
      entry('Петрова А.С.', '251-МО21'),
      entry('Петрова Анна Сергеевна', '251-МО21'),
    ])
    expect(out.map((s) => s.confidence)).toEqual(['high', 'low'])
    expect(out[0].target.student_name).toBe('Петрова Анна Сергеевна')
  })
})
