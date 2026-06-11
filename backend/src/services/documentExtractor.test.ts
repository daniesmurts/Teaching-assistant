import { describe, it, expect } from 'vitest'
import { cleanText, estimateTokens } from './documentExtractor'

describe('cleanText', () => {
  it('normalizes Windows line endings', () => {
    expect(cleanText('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree')
  })

  it('preserves form-feed page breaks (so chunker can derive page ranges)', () => {
    const out = cleanText('page one\fpage two\fpage three')
    expect(out.includes('\f')).toBe(true)
    expect(out.split('\f').length).toBe(3)
  })

  it('trims whitespace around form-feeds to a single \\f', () => {
    expect(cleanText('a   \f   b')).toBe('a\fb')
    expect(cleanText('a\t\f\tb')).toBe('a\fb')
  })

  it('replaces tabs with single spaces', () => {
    expect(cleanText('cell\tnext\tlast')).toBe('cell next last')
  })

  it('collapses runs of spaces but keeps newlines', () => {
    expect(cleanText('hello     world')).toBe('hello world')
    expect(cleanText('line1\nline2')).toBe('line1\nline2')
  })

  it('caps consecutive blank lines at two', () => {
    expect(cleanText('para1\n\n\n\n\npara2')).toBe('para1\n\npara2')
  })

  it('strips trailing whitespace per line', () => {
    expect(cleanText('line   \nother')).toBe('line\nother')
  })

  it('trims the entire string', () => {
    expect(cleanText('  \n\n  text  \n\n  ')).toBe('text')
  })
})

describe('estimateTokens', () => {
  it('estimates ~3.5 chars per token', () => {
    // 35-char string → ceil(35/3.5) = 10
    expect(estimateTokens('a'.repeat(35))).toBe(10)
  })

  it('rounds up partial tokens', () => {
    expect(estimateTokens('hi')).toBe(1)  // ceil(2/3.5)
  })

  it('handles empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })
})
