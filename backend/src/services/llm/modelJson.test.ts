import { describe, it, expect, vi } from 'vitest'
import {
  extractJSON, looksTruncated, repairTruncatedJSON, parseModelJSON,
  resolveModelJSON, TruncatedResponseError, InvalidModelJsonError,
} from './modelJson'

// Production, 2026-09-09: a teacher pressed «Построить план лекции» and was
// shown «Expected ',' or ']' after array element in JSON at position 3203».
// That message is what JSON.parse says about an array cut off mid-element and
// then trimmed back to its last complete `}` — which is exactly what
// extractJSON does to a severed answer. The truncation is the fact; the
// syntax error was an artefact of our own trimming.
const CUT_OFF =
  '{"outline":[' +
  '{"type":"title","title":"Классификации нефтей","brief":"обзор"},' +
  '{"type":"bullets","title":"Технологическая классификация","brief":"содержание серы"},' +
  '{"type":"concept","title":"Индекс вязкости базовых ма'

describe('looksTruncated', () => {
  it('sees a cut-off answer by its unclosed structure, before any trimming', () => {
    expect(looksTruncated(CUT_OFF)).toBe(true)
  })

  it('does not call a complete answer truncated', () => {
    expect(looksTruncated('{"outline":[{"type":"title","title":"Нефть","brief":"обзор"}]}')).toBe(false)
  })

  it('does not call merely-malformed JSON truncated — that one is worth a retry', () => {
    // Everything the model opened, it closed; it just wrote nonsense between.
    expect(looksTruncated('{"outline":[{"type":,}]}')).toBe(false)
  })

  it('is not fooled by brackets inside strings', () => {
    expect(looksTruncated('{"brief":"формула [1] и скобка {"}')).toBe(false)
  })
})

describe('repairTruncatedJSON', () => {
  it('keeps every element that finished and drops the one that did not', () => {
    const repaired = repairTruncatedJSON(CUT_OFF)!
    const parsed = JSON.parse(repaired) as { outline: { title: string }[] }
    expect(parsed.outline).toHaveLength(2)
    expect(parsed.outline.map((s) => s.title))
      .toEqual(['Классификации нефтей', 'Технологическая классификация'])
  })

  it('never leaves a trailing comma behind', () => {
    const repaired = repairTruncatedJSON('{"outline":[{"a":1},{"b":2}, {"c":')!
    expect(JSON.parse(repaired)).toEqual({ outline: [{ a: 1 }, { b: 2 }] })
  })

  it('returns null when the cut landed inside the first element — half an item is not a plan', () => {
    expect(repairTruncatedJSON('{"outline":[{"type":"tit')).toBeNull()
  })

  it('handles a cut inside a string containing a bracket', () => {
    const repaired = repairTruncatedJSON('{"outline":[{"a":"текст [с] скобками"},{"b":"обрыв ][ ')!
    expect(JSON.parse(repaired)).toEqual({ outline: [{ a: 'текст [с] скобками' }] })
  })
})

describe('parseModelJSON', () => {
  it('parses a clean answer without claiming anything was salvaged', () => {
    const r = parseModelJSON<{ outline: unknown[] }>('{"outline":[{"a":1}]}')
    expect(r).toMatchObject({ truncated: false, salvaged: false })
    expect(r.value).toEqual({ outline: [{ a: 1 }] })
  })

  it('salvages the complete part of a cut-off answer and says so', () => {
    const r = parseModelJSON<{ outline: unknown[] }>(CUT_OFF, 'outline')
    expect(r.truncated).toBe(true)
    expect(r.salvaged).toBe(true)
    expect(r.value!.outline).toHaveLength(2)
  })

  it('reports malformed-but-complete separately, so the caller can still retry it', () => {
    const r = parseModelJSON('{"outline":[{"type":,}]}')
    expect(r).toEqual({ value: null, truncated: false, salvaged: false })
  })

  it('reads an answer wrapped in a markdown fence', () => {
    const r = parseModelJSON<{ ok: boolean }>('```json\n{"ok":true}\n```')
    expect(r.value).toEqual({ ok: true })
  })
})

describe('extractJSON', () => {
  it('still unwraps a fenced answer and ignores surrounding prose', () => {
    expect(extractJSON('Вот план:\n```json\n{"a":1}\n```\nГотово')).toBe('{"a":1}')
    expect(extractJSON('Пояснение. {"a":1} Конец.')).toBe('{"a":1}')
  })
})

describe('resolveModelJSON — the production scenario end to end', () => {
  it('turns a cut-off outline into a shorter plan instead of an error', async () => {
    const retry = vi.fn()
    const value = await resolveModelJSON<{ outline: { title: string }[] }>(CUT_OFF, 'outline', retry)
    expect(value.outline).toHaveLength(2)
    // The retry is not attempted: it re-sends the same request under the same
    // token ceiling with the cut-off answer appended, so it is not merely
    // doomed — it is doomed with a longer prompt.
    expect(retry).not.toHaveBeenCalled()
  })

  it('asks again exactly once when the answer was malformed but complete', async () => {
    const retry = vi.fn(async () => '{"outline":[{"title":"Нефть"}]}')
    const value = await resolveModelJSON<{ outline: unknown[] }>('{"outline":[{"type":,}]}', 'outline', retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(value.outline).toHaveLength(1)
  })

  it('fails as truncation, not as a syntax error, when nothing survives', async () => {
    await expect(resolveModelJSON('{"outline":[{"type":"tit', 'outline', vi.fn()))
      .rejects.toBeInstanceOf(TruncatedResponseError)
  })

  it('fails as invalid JSON when the model writes nonsense twice', async () => {
    await expect(resolveModelJSON('{"outline":[{"type":,}]}', 'outline', async () => 'опять не JSON'))
      .rejects.toBeInstanceOf(InvalidModelJsonError)
  })
})
