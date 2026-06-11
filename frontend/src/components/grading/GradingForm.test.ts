import { describe, it, expect } from 'vitest'
import { evenWeights } from './GradingForm'

describe('evenWeights — distributing 100 across N criteria', () => {
  it('returns empty for n=0 or negative', () => {
    expect(evenWeights(0)).toEqual([])
    expect(evenWeights(-1)).toEqual([])
  })

  it('puts the full 100 on a single criterion', () => {
    expect(evenWeights(1)).toEqual([100])
  })

  it('splits evenly when possible', () => {
    expect(evenWeights(2)).toEqual([50, 50])
    expect(evenWeights(4)).toEqual([25, 25, 25, 25])
    expect(evenWeights(5)).toEqual([20, 20, 20, 20, 20])
  })

  it('distributes the remainder to the leading items', () => {
    expect(evenWeights(3)).toEqual([34, 33, 33])
    expect(evenWeights(6)).toEqual([17, 17, 17, 17, 16, 16])
    expect(evenWeights(7)).toEqual([15, 15, 14, 14, 14, 14, 14])
  })

  it('always sums to exactly 100', () => {
    for (let n = 1; n <= 10; n++) {
      const sum = evenWeights(n).reduce((s, w) => s + w, 0)
      expect(sum).toBe(100)
    }
  })

  it('produces an array of the requested length', () => {
    for (let n = 1; n <= 10; n++) {
      expect(evenWeights(n).length).toBe(n)
    }
  })
})
