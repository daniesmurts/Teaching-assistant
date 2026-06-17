import { describe, it, expect } from 'vitest'
import { clusterByName } from './longReview'
import type { KeyQuantity } from '../../../shared/types'

function kq(name: string, value: string, chapter_index: number): KeyQuantity {
  return { name, value, quote: `${value} в разделе ${chapter_index}`, chapter_index }
}

describe('clusterByName', () => {
  it('returns no candidates when nothing repeats', () => {
    const clusters = clusterByName([
      kq('плотность нефти', '850 кг/м³', 0),
      kq('температура',     '300 °C',    1),
    ])
    expect(clusters).toEqual([])
  })

  it('returns no candidates when same quantity has matching values', () => {
    // Same value in two sections — that's consistency, not contradiction.
    const clusters = clusterByName([
      kq('плотность нефти', '850 кг/м³', 0),
      kq('плотность нефти', '850 кг/м³', 3),
    ])
    expect(clusters).toEqual([])
  })

  it('flags a cluster when numeric values disagree', () => {
    const clusters = clusterByName([
      kq('плотность нефти', '850 кг/м³', 0),
      kq('плотность нефти', '920 кг/м³', 3),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].occurrences).toHaveLength(2)
    expect(clusters[0].display_name).toBe('плотность нефти')
  })

  it('groups by case-insensitive trimmed name', () => {
    const clusters = clusterByName([
      kq('Плотность нефти',  '850 кг/м³',  0),
      kq('  плотность нефти', '920 кг/м³', 4),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].occurrences).toHaveLength(2)
  })

  it('handles comma vs dot decimal separators as the same value', () => {
    // The deterministic check normalises decimal separators, so 0,5 and 0.5
    // are the same number → no candidate (avoids false positives from RU/EN
    // formatting drift).
    const clusters = clusterByName([
      kq('коэффициент',  '0,5', 0),
      kq('коэффициент',  '0.5', 2),
    ])
    expect(clusters).toEqual([])
  })

  it('ignores clusters where only one occurrence has a number', () => {
    // "не указано" vs "300 °C" — only one numeric value → no candidate.
    const clusters = clusterByName([
      kq('температура реакции', 'не указано', 0),
      kq('температура реакции', '300 °C',     2),
    ])
    expect(clusters).toEqual([])
  })

  it('returns multiple clusters when several quantities conflict', () => {
    const clusters = clusterByName([
      kq('плотность нефти', '850 кг/м³', 0),
      kq('плотность нефти', '920 кг/м³', 3),
      kq('температура',     '300 °C',    1),
      kq('температура',     '320 °C',    4),
    ])
    expect(clusters).toHaveLength(2)
  })
})
