import { describe, it, expect } from 'vitest'
import { evaluateExpression, extractLeadingNumber, numbersMatch, buildStepVerdict, toImprovementBullet } from './calcVerifier'

describe('evaluateExpression', () => {
  it('evaluates plain arithmetic', () => {
    expect(evaluateExpression('1000*0.5*0.1/0.001')).toBe(50000)
  })

  it('respects operator precedence and parens', () => {
    expect(evaluateExpression('(2+3)*4')).toBe(20)
    expect(evaluateExpression('2+3*4')).toBe(14)
  })

  it('normalises a comma decimal separator', () => {
    expect(evaluateExpression('1,5*2')).toBe(3)
  })

  it('allows whitelisted functions', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4)
  })

  it('rejects a string with disallowed characters (defense in depth)', () => {
    expect(evaluateExpression('import("fs")')).toBeNull()
    expect(evaluateExpression('process.exit()')).toBeNull()
    expect(evaluateExpression('__proto__')).toBeNull()
  })

  it('returns null instead of throwing on division by zero (Infinity is not a usable result)', () => {
    expect(evaluateExpression('1/0')).toBeNull()
  })

  it('returns null on empty or unparseable input', () => {
    expect(evaluateExpression('')).toBeNull()
    expect(evaluateExpression('   ')).toBeNull()
    expect(evaluateExpression('2+')).toBeNull()
  })

  it('returns null for non-real results (e.g. sqrt of a negative number)', () => {
    expect(evaluateExpression('sqrt(-1)')).toBeNull()
  })
})

describe('extractLeadingNumber', () => {
  it('extracts a plain number', () => {
    expect(extractLeadingNumber('47.3')).toBe(47.3)
  })

  it('normalises a comma decimal separator', () => {
    expect(extractLeadingNumber('47,3')).toBe(47.3)
  })

  it('extracts the number from a string with trailing units', () => {
    expect(extractLeadingNumber('50 кН')).toBe(50)
  })

  it('returns null when no number is present', () => {
    expect(extractLeadingNumber('см. график')).toBeNull()
  })
})

describe('numbersMatch', () => {
  it('matches an exact value', () => {
    expect(numbersMatch(50, 50)).toBe(true)
  })

  it('matches within relative tolerance (rounding)', () => {
    expect(numbersMatch(47.3, 47.298)).toBe(true)
  })

  it('rejects a genuine mismatch', () => {
    expect(numbersMatch(47.3, 52.1)).toBe(false)
  })
})

describe('buildStepVerdict', () => {
  it('flags a genuine arithmetic mismatch', () => {
    const v = buildStepVerdict({
      step_index: 2, description: 'Проверка Re', formula: 'Re = ρvd/μ',
      substitution: '1000*0.5*0.1/0.001', claimed_result: '47.3',
    })
    expect(v.verdict).toBe('arithmetic_error')
    expect(v.evaluated_result).toBe(50000)
    expect(v.note).toContain('47.3')
  })

  it('confirms a correct step', () => {
    const v = buildStepVerdict({
      step_index: 0, description: 'Площадь', formula: null,
      substitution: '2*3', claimed_result: '6',
    })
    expect(v.verdict).toBe('correct')
  })

  it('marks a step unevaluable when substitution is missing (integrals/tables/graphs are expected, not errors)', () => {
    const v = buildStepVerdict({
      step_index: 1, description: 'Интеграл по таблице', formula: null,
      substitution: null, claimed_result: '12.4',
    })
    expect(v.verdict).toBe('unevaluable')
  })
})

describe('toImprovementBullet', () => {
  const submission = 'Итоговое значение расхода составило 47.3 кг/с при расчёте по формуле баланса.'

  it('keeps the citation when the claimed result appears verbatim in the submission (min 8 chars, per the citation contract elsewhere)', () => {
    const verdict = buildStepVerdict({
      step_index: 0, description: 'Расход', formula: 'Q = G*c*dT',
      substitution: '1000*0.5*0.1/0.001', claimed_result: '47.3 кг/с',
    })
    const bullet = toImprovementBullet(verdict, submission, 1)
    expect(bullet.quote).toBe('47.3 кг/с')
    expect(bullet.severity).toBe('substantial')
    expect(bullet.action).toBe('verify')
    expect(bullet.text).toContain('47.3')
  })

  it('drops a too-short claimed-result string even if it appears verbatim (below the 8-char citation floor)', () => {
    const verdict = buildStepVerdict({
      step_index: 0, description: 'Расход', formula: null,
      substitution: '1000*0.5*0.1/0.001', claimed_result: '47.3',
    })
    const bullet = toImprovementBullet(verdict, submission, 1)
    expect(bullet.quote).toBeNull()
  })

  it('drops the citation when the claimed result does not appear verbatim', () => {
    const verdict = buildStepVerdict({
      step_index: 0, description: 'Расход', formula: null,
      substitution: '2*2', claimed_result: '999',
    })
    const bullet = toImprovementBullet(verdict, submission, 1)
    expect(bullet.quote).toBeNull()
  })
})
