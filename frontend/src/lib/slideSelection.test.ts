import { describe, it, expect } from 'vitest'
import {
  remapAfterMove, remapAfterDelete, remapAfterInsert, toSlideNumbers, rangeBetween,
} from './slideSelection'

const sel = (...xs: number[]) => new Set(xs)
const shown = (s: Set<number>) => [...s].sort((a, b) => a - b)

describe('remapAfterMove', () => {
  it('follows a selected slide to its new position', () => {
    expect(shown(remapAfterMove(sel(1), 1, 4))).toEqual([4])
  })

  it('shifts the slides the move passed over, downwards', () => {
    // 1 moves to 4: everything that was 2..4 slides up one.
    expect(shown(remapAfterMove(sel(2, 3, 6), 1, 4))).toEqual([1, 2, 6])
  })

  it('shifts them upwards when the slide travels the other way', () => {
    expect(shown(remapAfterMove(sel(1, 2, 6), 4, 1))).toEqual([2, 3, 6])
  })

  it('leaves slides outside the moved range alone', () => {
    expect(shown(remapAfterMove(sel(0, 9), 3, 5))).toEqual([0, 9])
  })

  it('is a no-op when nothing actually moved', () => {
    const s = sel(1, 2)
    expect(remapAfterMove(s, 2, 2)).toBe(s)
  })
})

describe('remapAfterDelete', () => {
  it('drops the deleted slide and pulls the ones after it down', () => {
    // Tick 3 and 7 (indices 2, 6), delete slide 5 (index 4) — the selection
    // must still mean slides 3 and 7, which are now indices 2 and 5.
    expect(shown(remapAfterDelete(sel(2, 6), 4))).toEqual([2, 5])
  })

  it('removes a slide that was itself selected', () => {
    expect(shown(remapAfterDelete(sel(2, 4), 4))).toEqual([2])
  })

  it('leaves earlier slides untouched', () => {
    expect(shown(remapAfterDelete(sel(0, 1), 5))).toEqual([0, 1])
  })
})

describe('remapAfterInsert', () => {
  it('pushes later slides down and leaves the new one unselected', () => {
    expect(shown(remapAfterInsert(sel(1, 4), 2))).toEqual([1, 5])
  })

  it('does not move a selection that sits above the insertion point', () => {
    expect(shown(remapAfterInsert(sel(0, 1), 3))).toEqual([0, 1])
  })
})

describe('toSlideNumbers', () => {
  it('speaks the 1-based numbers on the cards, in deck order', () => {
    expect(toSlideNumbers(sel(4, 0, 2))).toEqual([1, 3, 5])
  })

  it('is empty for an empty selection', () => {
    expect(toSlideNumbers(sel())).toEqual([])
  })
})

describe('rangeBetween', () => {
  it('covers both ends inclusively', () => {
    expect(rangeBetween(2, 5)).toEqual([2, 3, 4, 5])
  })

  it('works when shift-clicking upwards', () => {
    expect(rangeBetween(5, 2)).toEqual([2, 3, 4, 5])
  })

  it('handles a click on the anchor itself', () => {
    expect(rangeBetween(3, 3)).toEqual([3])
  })
})
