import { describe, it, expect } from 'vitest'
import { cleanForSlide, generatePresentationPptx, latexToPlainText } from './presentationExport'
import type { Presentation } from '../../../shared/types'

describe('latexToPlainText', () => {
  it('converts Greek letters', () => {
    expect(latexToPlainText('\\rho g Q H')).toBe('ρ g Q H')
    expect(latexToPlainText('\\eta \\Omega')).toBe('η Ω')
  })

  it('does not let a longer command name get shadowed by a shorter one', () => {
    expect(latexToPlainText('\\varrho')).toBe('ρ')
    expect(latexToPlainText('\\rho')).toBe('ρ')
  })

  it('converts \\frac to a parenthesised division', () => {
    expect(latexToPlainText('\\frac{a}{b}')).toBe('(a)/(b)')
  })

  it('converts \\frac whose arguments themselves contain a subscript (nested braces)', () => {
    expect(latexToPlainText('\\eta = \\frac{P_{полезн}}{P_{затрач}}'))
      .toBe('η = (P_полезн)/(P_затрач)')
  })

  it('converts \\sqrt with and without braces', () => {
    expect(latexToPlainText('\\sqrt{x+1}')).toBe('√(x+1)')
    expect(latexToPlainText('\\sqrt2')).toBe('√2')
  })

  it('converts single-character superscripts and subscripts', () => {
    expect(latexToPlainText('x^2')).toBe('x²')
    expect(latexToPlainText('a_1')).toBe('a₁')
  })

  it('converts braced multi-character superscripts and subscripts', () => {
    expect(latexToPlainText('x^{23}')).toBe('x²³')
    expect(latexToPlainText('a_{max}')).toBe('a_max')  // non-digit subscript chars have no unicode form — kept as-is, no stray brace
  })

  it('converts common operators', () => {
    expect(latexToPlainText('a \\cdot b \\times c')).toBe('a · b × c')
    expect(latexToPlainText('x \\leq y \\geq z')).toBe('x ≤ y ≥ z')
  })

  it('drops the backslash from an unrecognised command instead of leaving it raw', () => {
    expect(latexToPlainText('\\text{Re}')).toBe('textRe')
  })

  it('leaves plain arithmetic untouched', () => {
    expect(latexToPlainText('P = m g h')).toBe('P = m g h')
  })
})

describe('cleanForSlide', () => {
  it('strips a single citation marker', () => {
    expect(cleanForSlide('Насосы делятся на два типа [1].')).toBe('Насосы делятся на два типа .')
  })

  it('strips a multi-number citation marker', () => {
    expect(cleanForSlide('См. источники [1, 2, 3]')).toBe('См. источники')
  })

  it('converts inline LaTeX to readable Unicode instead of leaving raw commands', () => {
    expect(cleanForSlide('Мощность $P = \\rho g Q H$ насоса')).toBe('Мощность P = ρ g Q H насоса')
  })

  it('converts block LaTeX to readable Unicode', () => {
    expect(cleanForSlide('$$x^2 + y^2$$')).toBe('x² + y²')
  })

  it('collapses runs of spaces left behind by stripping', () => {
    expect(cleanForSlide('Текст   с   пробелами')).toBe('Текст с пробелами')
  })

  it('trims leading/trailing whitespace', () => {
    expect(cleanForSlide('  текст  ')).toBe('текст')
  })

  it('leaves plain text untouched', () => {
    expect(cleanForSlide('Обычный текст без разметки')).toBe('Обычный текст без разметки')
  })
})

function slideBase(overrides: Partial<{ notes: string; citations: number[] }> = {}) {
  return { notes: '', citations: [], ...overrides }
}

describe('generatePresentationPptx', () => {
  // pptxgenjs 4.0.1's createContentTypesXml() writes one `<Override .../ppt/
  // slideMasters/slideMasterN.xml>` per SLIDE (using the slide index, not
  // the real master count) even though this deck only ever has one actual
  // ppt/slideMasters/slideMaster1.xml — every multi-slide deck therefore
  // shipped a [Content_Types].xml pointing at slideMaster2.xml,
  // slideMaster3.xml etc. that don't exist in the zip, which is exactly
  // what PowerPoint's "found a problem with content...[Repaired]" dialog
  // flags. generatePresentationPptx() post-processes the zip to strip those
  // dangling entries (see fixDanglingSlideMasterEntries) — this asserts the
  // fix on a 5-slide deck (one more slide than the single real master).
  it('does not reference a slideMasterN.xml part beyond the one that actually exists in the zip', async () => {
    const presentation: Presentation = {
      id: 'p1', teacher_id: 't1', course_id: null, course_name: null, lecture_number: null,
      topic: 'Test', duration_minutes: null, audience_level: null, learning_goals: null,
      style: null, slide_count_target: null, generated_content: null, sources: null,
      created_at: '',
      slides: [
        { type: 'title', title: 'Title', ...slideBase(), body: { subtitle: 'Sub', lecturer: 'L' } },
        { type: 'bullets', title: 'B1', ...slideBase(), body: { items: ['a', 'b'] } },
        { type: 'bullets', title: 'B2', ...slideBase(), body: { items: ['c', 'd'] } },
        { type: 'bullets', title: 'B3', ...slideBase(), body: { items: ['e', 'f'] } },
        { type: 'summary', title: 'S', ...slideBase(), body: { takeaways: ['x'], next_steps: ['y'] } },
      ],
    } as Presentation

    const buffer = await generatePresentationPptx(presentation)

    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    const realMasterFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))
    expect(realMasterFiles).toEqual(['ppt/slideMasters/slideMaster1.xml'])

    const contentTypesXml = await zip.file('[Content_Types].xml')!.async('string')
    const declaredMasters = [...contentTypesXml.matchAll(/\/ppt\/slideMasters\/slideMaster(\d+)\.xml/g)]
      .map((m) => Number(m[1]))
    expect(declaredMasters).toEqual([1])
  })

  // A formula slide's rendered images are far taller than the single line of
  // text they replaced, so a slide with several formulas used to run the
  // layout cursor past the bottom of the slide — and the explanation box
  // below it was then sized `SLIDE_H - y - 0.4`, i.e. NEGATIVE (one real
  // deck had cy="-3966630", about -4.34"). DrawingML requires cx/cy > 0, so
  // PowerPoint refused to open the deck ("PowerPoint found a problem with
  // content..."). Assert the invariant on the whole package rather than just
  // that one box: no shape anywhere may have a non-positive extent.
  it('emits no non-positive shape extents on a formula-dense deck (would corrupt the package)', async () => {
    const formula = (latex: string, caption: string) => ({ latex, caption })
    const presentation: Presentation = {
      id: 'p2', teacher_id: 't1', course_id: null, course_name: null, lecture_number: null,
      topic: 'Формулы', duration_minutes: null, audience_level: null, learning_goals: null,
      style: null, slide_count_target: null, generated_content: null, sources: null,
      created_at: '',
      slides: [
        // Four captioned formulas + an explanation — the exact shape that overran.
        {
          type: 'formula', title: 'Уравнения сохранения', ...slideBase(),
          body: {
            formulas: [
              formula(String.raw`\frac{\partial \rho}{\partial t} + \frac{\partial (\rho u_i)}{\partial x_i} = 0`, 'Неразрывность'),
              formula(String.raw`\frac{\partial (\rho u_i)}{\partial t} = -\frac{\partial p}{\partial x_i} + \rho g_i`, 'Импульс'),
              formula(String.raw`\rho\frac{DU_i}{Dt}=\frac{\partial}{\partial x_j}\left[\mu\left(\frac{\partial U_i}{\partial x_j}\right)-\rho\overline{u_i'u_j'}\right]`, 'RANS'),
              formula(String.raw`\frac{\partial (\rho C)}{\partial t} = \frac{\partial}{\partial x_i}\left(\Gamma \frac{\partial C}{\partial x_i}\right) + S_C`, 'Перенос примеси'),
            ],
            explanation: 'Показаны уравнения неразрывности, импульса и переноса примеси.',
          },
        },
        // Diagram slide with a caption — the other dynamically-sized height.
        {
          type: 'diagram', title: 'Схема', ...slideBase(),
          body: { image_query: 'схема', caption: 'Подпись', points: ['раз', 'два'], image: null },
        },
      ],
    } as Presentation

    const buffer = await generatePresentationPptx(presentation)

    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    expect(slideNames.length).toBe(2)

    for (const name of slideNames) {
      const xml = await zip.file(name)!.async('string')
      // <p:grpSpPr> carries a legitimate all-zero xfrm (the spTree's own
      // group bounds) in every valid PowerPoint file — drop those blocks so
      // the assertion only covers extents belonging to real shapes/pictures.
      const shapesOnly = xml.replace(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/g, '')
      const extents = [...shapesOnly.matchAll(/\b(cx|cy)="(-?\d+)"/g)]
      expect(extents.length).toBeGreaterThan(0)
      const bad = extents.filter(([, , v]) => Number(v) <= 0).map(([m]) => `${name}: ${m}`)
      expect(bad).toEqual([])
    }
  }, 30_000)
})
