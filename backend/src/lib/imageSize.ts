/**
 * Intrinsic pixel dimensions of a PNG or JPEG, read from the bytes.
 *
 * Needed because pptxgenjs cannot be trusted to preserve aspect ratio: passing
 * `w`/`h` alongside `sizing: { type: 'contain' }` draws the image at the frame
 * size regardless, so a wide university logo in a 2.4×0.7in box came out
 * visibly squashed. Knowing the real dimensions lets the caller compute a
 * contain-fit itself and pass exact w/h — which pptxgenjs does honour.
 *
 * No image library: this reads two well-defined headers. PNG carries width and
 * height as big-endian uint32 at a fixed offset in IHDR; JPEG requires walking
 * the marker chain to a start-of-frame segment, since the dimensions live
 * there rather than at a fixed position.
 */

export interface ImageSize { width: number; height: number }

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// SOF0…SOF15 carry the frame dimensions. C4 (DHT), C8 (JPG) and CC (DAC) sit
// inside that numeric range but are NOT start-of-frame markers.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function pngSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function jpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  // <=, not <: reading the width needs bytes through offset+8, so a frame
  // ending exactly at the buffer's end is still readable.
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }   // resync past padding
    const marker = buffer[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2                                            // standalone, no length
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (SOF_MARKERS.has(marker)) {
      // segment: length(2) precision(1) height(2) width(2)
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

export function imageSize(buffer: Buffer): ImageSize | null {
  const size = pngSize(buffer) ?? jpegSize(buffer)
  return size && size.width > 0 && size.height > 0 ? size : null
}

/**
 * The largest box with the image's aspect ratio that fits inside `maxW`×`maxH`,
 * centred horizontally within `maxW`. Returns null when the dimensions can't be
 * read, so the caller can fall back rather than guess an aspect ratio.
 */
export function containFit(
  buffer: Buffer,
  maxW: number,
  maxH: number,
): { w: number; h: number; dx: number } | null {
  const size = imageSize(buffer)
  if (!size) return null

  const scale = Math.min(maxW / size.width, maxH / size.height)
  const w = size.width * scale
  const h = size.height * scale
  return { w, h, dx: (maxW - w) / 2 }
}
