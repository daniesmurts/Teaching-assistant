import { describe, it, expect } from 'vitest'
import { isInstructorRole, isLearnerRole } from './lti'

describe('isInstructorRole', () => {
  it('matches the standard Instructor role URI', () => {
    expect(isInstructorRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'])).toBe(true)
  })

  it('matches ContentDeveloper as an instructor-equivalent role', () => {
    expect(isInstructorRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper'])).toBe(true)
  })

  it('matches when the instructor role is one of several roles on the token', () => {
    expect(isInstructorRole([
      'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Staff',
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    ])).toBe(true)
  })

  it('does not match a learner-only role list', () => {
    expect(isInstructorRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'])).toBe(false)
  })

  it('does not match an empty role list', () => {
    expect(isInstructorRole([])).toBe(false)
  })
})

describe('isLearnerRole', () => {
  it('matches the standard Learner role URI', () => {
    expect(isLearnerRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'])).toBe(true)
  })

  it('does not match an instructor-only role list', () => {
    expect(isLearnerRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'])).toBe(false)
  })

  it('does not match an empty role list', () => {
    expect(isLearnerRole([])).toBe(false)
  })
})
