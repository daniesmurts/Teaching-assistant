import { describe, it, expect } from 'vitest'
import { tiptapToText, tiptapCharCount } from './tiptapText'

const doc = (...content: any[]) => ({ type: 'doc', content })
const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })

describe('tiptapToText', () => {
  it('returns empty for non-documents', () => {
    expect(tiptapToText(null)).toBe('')
    expect(tiptapToText(undefined)).toBe('')
    expect(tiptapToText('nope')).toBe('')
    expect(tiptapToText(doc())).toBe('')
  })

  it('extracts text across paragraphs with newline separation', () => {
    expect(tiptapToText(doc(para('Первый абзац'), para('Второй абзац'))))
      .toBe('Первый абзац\nВторой абзац')
  })

  it('collects nested inline text', () => {
    const d = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'жирный ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'и обычный' },
      ],
    })
    expect(tiptapToText(d)).toBe('жирный и обычный')
  })

  it('collapses excess blank lines and trims', () => {
    expect(tiptapToText(doc(para('A'), para(''), para(''), para('B')))).toBe('A\n\nB')
  })

  it('counts characters of the flattened text', () => {
    expect(tiptapCharCount(doc(para('абвг')))).toBe(4)
    expect(tiptapCharCount(doc())).toBe(0)
  })
})
