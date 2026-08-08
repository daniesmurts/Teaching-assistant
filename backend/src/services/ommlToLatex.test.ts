import { describe, it, expect } from 'vitest'
import { ommlNodeToLatex, extractDocxTextWithFormulas } from './ommlToLatex'

const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

async function toLatex(innerXml: string): Promise<string> {
  const { XMLParser } = await import('fast-xml-parser')
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false })
  const xml = `<m:oMath ${MATH_NS}>${innerXml}</m:oMath>`
  const parsed = parser.parse(xml) as Record<string, unknown>[]
  return ommlNodeToLatex(parsed[0])
}

function run(text: string): string {
  return `<m:r><m:t>${text}</m:t></m:r>`
}

describe('ommlNodeToLatex', () => {
  it('converts a fraction', async () => {
    const latex = await toLatex(`<m:f><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`)
    expect(latex).toBe('\\frac{a}{b}')
  })

  it('converts nested fractions (a partial-derivative style formula)', async () => {
    const latex = await toLatex(
      `<m:f><m:num>${run('∂ρ')}</m:num><m:den>${run('∂t')}</m:den></m:f>${run('+')}` +
      `<m:f><m:num>${run('∂u')}</m:num><m:den>${run('∂x')}</m:den></m:f>`,
    )
    expect(latex).toBe('\\frac{∂ρ}{∂t}+\\frac{∂u}{∂x}')
  })

  it('converts superscript and subscript', async () => {
    expect(await toLatex(`<m:sSup><m:e>${run('x')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`)).toBe('x^{2}')
    expect(await toLatex(`<m:sSub><m:e>${run('u')}</m:e><m:sub>${run('i')}</m:sub></m:sSub>`)).toBe('u_{i}')
  })

  it('converts a square root without a degree', async () => {
    const latex = await toLatex(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${run('x')}</m:e></m:rad>`)
    expect(latex).toBe('\\sqrt{x}')
  })

  it('converts \\left[ ... \\right] delimiters from m:d', async () => {
    const latex = await toLatex(
      `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${run('x')}</m:e></m:d>`,
    )
    expect(latex).toBe('\\left[x\\right]')
  })

  it('converts \\overline from m:bar (the RANS Reynolds-stress term)', async () => {
    const latex = await toLatex(
      `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${run("u_i'u_j'")}</m:e></m:bar>`,
    )
    expect(latex).toBe("\\overline{u_i'u_j'}")
  })

  it('converts a nary sum with limits', async () => {
    const latex = await toLatex(
      `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>` +
      `<m:sub>${run('i=1')}</m:sub><m:sup>${run('n')}</m:sup><m:e>${run('x_i')}</m:e></m:nary>`,
    )
    expect(latex).toBe('\\sum_{i=1}^{n} x_i')
  })

  it('recognises a known function name (sin) and uses \\operatorname for an unknown one', async () => {
    const known = await toLatex(`<m:func><m:fName>${run('sin')}</m:fName><m:e>${run('x')}</m:e></m:func>`)
    expect(known).toBe('\\sin{x}')
    const unknown = await toLatex(`<m:func><m:fName>${run('foo')}</m:fName><m:e>${run('x')}</m:e></m:func>`)
    expect(unknown).toBe('\\operatorname{foo}(x)')
  })

  it('falls back to raw text for an unrecognised OMML element instead of dropping it', async () => {
    const latex = await toLatex(`<m:unknownThing>${run('kept')}</m:unknownThing>`)
    expect(latex).toBe('kept')
  })
})

// ─── End-to-end: a hand-built minimal .docx (no real Word/mammoth needed) ──

const WORD_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function buildDocxDocumentXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${WORD_NS} ${MATH_NS}><w:body>${bodyXml}</w:body></w:document>`
}

async function buildMinimalDocx(bodyXml: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('word/document.xml', buildDocxDocumentXml(bodyXml))
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('extractDocxTextWithFormulas', () => {
  it('inlines an m:oMath formula as $...$ next to its surrounding paragraph text', async () => {
    const body =
      `<w:p><w:r><w:t>Уравнение неразрывности:</w:t></w:r>` +
      `<m:oMath><m:f><m:num>${run('∂ρ')}</m:num><m:den>${run('∂t')}</m:den></m:f></m:oMath></w:p>`
    const buffer = await buildMinimalDocx(body)

    const result = await extractDocxTextWithFormulas(buffer)
    expect(result).not.toBeNull()
    expect(result!.formulaCount).toBe(1)
    expect(result!.text).toContain('Уравнение неразрывности:')
    expect(result!.text).toContain('$\\frac{∂ρ}{∂t}$')
  })

  it('wraps a block m:oMathPara formula as $$...$$', async () => {
    const body = `<w:p><m:oMathPara><m:oMath>${run('E=mc')}<m:sSup><m:e>${run('')}</m:e><m:sup>${run('2')}</m:sup></m:sSup></m:oMath></m:oMathPara></w:p>`
    const buffer = await buildMinimalDocx(body)

    const result = await extractDocxTextWithFormulas(buffer)
    expect(result).not.toBeNull()
    expect(result!.formulaCount).toBe(1)
    expect(result!.text).toContain('$$')
  })

  it('returns null (so the caller falls back to mammoth) when word/document.xml is missing', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('README.txt', 'not a docx')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    expect(await extractDocxTextWithFormulas(buffer)).toBeNull()
  })

  it('reports zero formulas for a plain-text-only document (no m:oMath present)', async () => {
    const body = `<w:p><w:r><w:t>Обычный текст без формул.</w:t></w:r></w:p>`
    const buffer = await buildMinimalDocx(body)

    const result = await extractDocxTextWithFormulas(buffer)
    expect(result).not.toBeNull()
    expect(result!.formulaCount).toBe(0)
    expect(result!.text).toBe('Обычный текст без формул.')
  })
})
