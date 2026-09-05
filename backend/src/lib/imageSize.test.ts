import { describe, it, expect } from 'vitest'
import { imageSize, containFit } from './imageSize'

// The bug this exists for: a university logo came out of the PPTX export
// visibly squashed, because pptxgenjs draws at the frame size when given both
// w/h and `sizing: contain`. Computing the fit needs the real dimensions.

// 1×1 PNG, and a 2×1 PNG — enough to prove the IHDR read, since the header
// offsets are fixed regardless of image content.
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const PNG_2x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADwdn+XAAAAD0lEQVR42mP8z8BQz0AEAAAsAgQAKz8vAAAAAABJRU5ErkJggg==', 'base64')

describe('imageSize', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(imageSize(PNG_1x1)).toEqual({ width: 1, height: 1 })
    expect(imageSize(PNG_2x1)).toEqual({ width: 2, height: 1 })
  })

  it('reads JPEG dimensions by walking to the start-of-frame marker', () => {
    // Minimal JPEG: SOI, an APP0 segment to skip over, then SOF0 declaring
    // 40×20 — the walk has to pass the first segment to find the second.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),                                    // SOI
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),            // APP0, length 4
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 20, 0x00, 40]), // SOF0 h=20 w=40
    ])
    expect(imageSize(jpeg)).toEqual({ width: 40, height: 20 })
  })

  it('returns null for something that is not an image', () => {
    expect(imageSize(Buffer.from('не картинка'))).toBeNull()
    expect(imageSize(Buffer.alloc(0))).toBeNull()
  })
})

describe('containFit', () => {
  it('fits a WIDE logo by width, leaving height to spare', () => {
    // The real case: a 2:1 logo in a 2.4×0.7in box. Fitting by height would
    // demand 1.4in of width it does not have, so width is the constraint.
    const fit = containFit(PNG_2x1, 2.4, 0.7)!
    expect(fit.w).toBeCloseTo(1.4, 5)     // 0.7 × 2
    expect(fit.h).toBeCloseTo(0.7, 5)
    expect(fit.w / fit.h).toBeCloseTo(2, 5)   // aspect preserved — the whole point
  })

  it('fits a SQUARE crest by height and centres it', () => {
    const fit = containFit(PNG_1x1, 2.4, 0.7)!
    expect(fit.w).toBeCloseTo(0.7, 5)
    expect(fit.h).toBeCloseTo(0.7, 5)
    expect(fit.dx).toBeCloseTo((2.4 - 0.7) / 2, 5)   // centred in the box
  })

  it('never enlarges beyond the box in either direction', () => {
    const fit = containFit(PNG_2x1, 1.0, 1.0)!
    expect(fit.w).toBeLessThanOrEqual(1.0)
    expect(fit.h).toBeLessThanOrEqual(1.0)
  })

  it('returns null when the dimensions cannot be read, so the caller can fall back', () => {
    expect(containFit(Buffer.from('junk'), 2.4, 0.7)).toBeNull()
  })
})
