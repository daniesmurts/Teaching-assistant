import { ValidationError } from '../errors/AppError'
import type { Presentation, Slide } from '../../../shared/types'

// «Скачать выбранные слайды» — a teacher who wants three slides out of a
// forty-slide lecture (asked for 2026-09-11) should not have to export the
// deck and delete the rest in PowerPoint.
//
// Selection is a QUERY PARAMETER, not a stored thing: `?slides=2,3,5`. Nothing
// about it belongs in the database — it is a property of one download, not of
// the deck — and both export routes already take the whole presentation, so
// the entire server side is "filter before handing over".
//
// Numbers are 1-BASED, matching what the teacher sees on the slide cards and
// in the filename. A URL is a thing people read and occasionally hand-edit;
// `slides=1` meaning the second slide would be a trap.

/**
 * Parse the `slides` parameter into 0-based indices, in DECK order.
 *
 * Deck order, never the order they were typed: a selection is "which slides",
 * not "in what sequence". Silently reordering somebody's lecture because they
 * happened to tick slide 5 before slide 3 is a worse outcome than any error.
 *
 * Returns null for "no selection" — the whole deck, exactly as before.
 */
export function parseSlideSelection(raw: unknown, total: number): number[] | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new ValidationError('Некорректный список слайдов.')

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new ValidationError('Не выбрано ни одного слайда.')

  const indices = new Set<number>()
  for (const part of parts) {
    // Strict: `3.5`, `3a` and `-3` are mistakes, and guessing what a mistake
    // meant is how a teacher ends up with slides they did not choose.
    if (!/^\d+$/.test(part)) throw new ValidationError('Некорректный список слайдов.')
    const n = Number(part)
    if (n < 1 || n > total) {
      throw new ValidationError(`В презентации ${total} слайдов — слайда №${n} в ней нет.`)
    }
    indices.add(n - 1)
  }

  return [...indices].sort((a, b) => a - b)
}

/**
 * A presentation carrying only the chosen slides.
 *
 * Shallow copy — the original object is still the row the rest of the request
 * may use (artifact events, the filename, branding lookup), and mutating it
 * to serve one download would be a trap for the next person to add a line
 * below the export call.
 *
 * `sources` is narrowed to what the chosen slides actually cite. The раздатка
 * prints that list, and a three-slide handout carrying a twelve-entry
 * bibliography is not a smaller document, it is a wrong one. Numbering is
 * preserved rather than compacted: a slide's own text says «[7]», and
 * renumbering the list without rewriting every body string would point that
 * marker at the wrong book.
 */
export function selectSlides(presentation: Presentation, indices: number[] | null): Presentation {
  const slides = presentation.slides ?? []
  if (!indices || indices.length === slides.length) return presentation

  const chosen = indices.map((i) => slides[i]).filter(Boolean) as Slide[]
  const cited = new Set(chosen.flatMap((s) => s.citations ?? []))

  return {
    ...presentation,
    slides:  chosen,
    sources: (presentation.sources ?? []).filter((s) => cited.has(s.idx)),
  }
}

/**
 * What to call the file, so three partial exports of one lecture do not land
 * in Downloads as «Тема.pptx», «Тема (1).pptx», «Тема (2).pptx».
 */
export function selectionSuffix(indices: number[] | null, total: number): string {
  if (!indices || indices.length === total) return ''
  if (indices.length === 1) return ` (слайд ${indices[0] + 1})`

  const contiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1)
  return contiguous
    ? ` (слайды ${indices[0] + 1}–${indices[indices.length - 1] + 1})`
    : ` (${indices.length} ${pluralSlides(indices.length)})`
}

/** 1 слайд / 2 слайда / 5 слайдов — Russian needs three forms, not two. */
function pluralSlides(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'слайдов'
  switch (n % 10) {
    case 1:  return 'слайд'
    case 2:
    case 3:
    case 4:  return 'слайда'
    default: return 'слайдов'
  }
}
