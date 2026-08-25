import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toItem, reviewSyllabus, type Requirement, type RawScored } from './syllabusReview'
import type { ContentSection } from '../../../shared/types'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

// mockResolvedValueOnce builds a queue, and a review does NOT always make the
// same number of LLM calls — when every ЗУВ line is a verbatim copy there is
// nothing left for the meaning pass to judge, so it returns without calling
// the model at all. Without a reset the unconsumed mock shifts every
// subsequent test's responses by one.
beforeEach(() => chatJSONMock.mockReset())

// toItem is the deterministic layer of the РПД conformance check: it validates
// the model's excerpt quotes against the real section text and enforces the
// scoring rubric ("covered" requires verifiable evidence). These tests pin
// that behaviour — the LLM layer above it is stabilised separately via
// temperature 0.

const req: Requirement = {
  ref: 'K0', kind: 'knowledge', code: null,
  title: 'основные численные методы', parent_code: null,
}

// Haystacks are pre-normalised (lowercase, collapsed whitespace) by the caller.
function haystacks(overrides: Partial<Record<ContentSection, string>> = {}): Record<ContentSection, string> {
  return {
    lectures:    'тема 1. численные методы решения уравнений. тема 2. интерполяция и аппроксимация.',
    practicals:  'решение систем линейных уравнений методом гаусса.',
    labs:        '',
    independent: '',
    control:     'экзамен по билетам, включающим численные методы.',
    ...overrides,
  }
}

function raw(overrides: Partial<RawScored> = {}): RawScored {
  return {
    ref: 'K0',
    status: 'covered',
    score: 90,
    sources: [{ section: 'lectures', excerpt: 'численные методы решения уравнений' }],
    gap: '',
    recommendation: '',
    ...overrides,
  }
}

describe('toItem — excerpt validation', () => {
  it('keeps a source whose excerpt appears verbatim in the claimed section', () => {
    const item = toItem(req, raw(), haystacks())
    expect(item.status).toBe('covered')
    expect(item.sources).toHaveLength(1)
    expect(item.evidence).toBe('численные методы решения уравнений')
  })

  it('matches case- and whitespace-insensitively', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'ЧИСЛЕННЫЕ   МЕТОДЫ\nрешения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(1)
  })

  it('drops a hallucinated excerpt that is not in the section', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'глубокое обучение и нейронные сети' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops an excerpt attributed to the wrong section', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'labs', excerpt: 'численные методы решения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops excerpts shorter than 8 characters (too weak to verify)', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'тема 1' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops sources with an invalid section name', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'seminars', excerpt: 'численные методы решения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })
})

describe('toItem — rubric enforcement (covered requires evidence)', () => {
  it('demotes covered → partial when every excerpt fails validation', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' }],
    }), haystacks())
    expect(item.status).toBe('partial')
  })

  it('discards the model score on demotion (falls back to the partial default)', () => {
    const item = toItem(req, raw({
      score: 95,
      sources: [{ section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' }],
    }), haystacks())
    expect(item.status).toBe('partial')
    expect(item.score).toBe(55)   // clampScore's partial default, not the model's 95
  })

  it('does not demote partial/missing — the rubric only binds covered', () => {
    const item = toItem(req, raw({ status: 'partial', sources: [] }), haystacks())
    expect(item.status).toBe('partial')
    const item2 = toItem(req, raw({ status: 'missing', sources: [], score: 10 }), haystacks())
    expect(item2.status).toBe('missing')
  })

  it('keeps covered when at least one source survives validation', () => {
    const item = toItem(req, raw({
      sources: [
        { section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' },
        { section: 'control',  excerpt: 'экзамен по билетам' },
      ],
    }), haystacks())
    expect(item.status).toBe('covered')
    expect(item.sources).toHaveLength(1)
    expect(item.sources[0].section).toBe('control')
  })
})

describe('toItem — defensive defaults', () => {
  it('treats a requirement the model skipped entirely as missing', () => {
    const item = toItem(req, undefined, haystacks())
    expect(item.status).toBe('missing')
    expect(item.score).toBe(15)
    expect(item.sources).toHaveLength(0)
  })

  it('treats an invalid status string as missing', () => {
    const item = toItem(req, raw({ status: 'excellent', sources: [] }), haystacks())
    expect(item.status).toBe('missing')
  })
})

// The 2026-08-24 defect, reproduced at the level it actually broke: the pure
// copy-detector in outcomeFormulation.ts was always correct (its own suite
// passes on this very ОПК-4.1 pair), so a unit test there could never have
// caught this. The bug was in what reviewSyllabus FED it — only nested
// indicators — and a real КНИТУ РПД lists competencies flat at the indicator
// level, producing an empty indicator array and a silent no-op. The методист
// re-tested and still saw «Обеспечена 90%» with no formulation warning.
describe('reviewSyllabus — formulation findings on a flat-competency РПД', () => {
  const INDICATOR = 'Знает и понимает сущность технологических процессов производства кулинарной продукции для индустрии питания'
  const COPIED_ZUV = 'сущность технологических процессов производства кулинарной продукции для индустрии питания'

  // Her document's shape: ОПК-4.1 as a TOP-LEVEL competency, `indicators` empty.
  // Three LLM calls per review, in order: parse → score → meaning.
  function mockParseAndScore(competencies: unknown, meaning: unknown = { items: [] }) {
    chatJSONMock
      .mockResolvedValueOnce({
        goals: [],
        competencies,
        outcomes: { knowledge: [COPIED_ZUV], skills: [], mastery: [] },
        technologies: [],
        content: {
          practicals: 'Умная кухня: датчики, термометры и электронные чек-листы.',
          independent: 'Цифровой контроль качества: от входного контроля до сертификации готовой продукции.',
        },
      })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce(meaning)
  }

  it('flags a ЗУВ copied from a competency listed flat at the indicator level', async () => {
    mockParseAndScore([{ code: 'ОПК-4.1', title: INDICATOR, indicators: [] }])

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.formulation_findings).toHaveLength(1)
    expect(result.formulation_findings![0].indicator_code).toBe('ОПК-4.1')
    expect(result.formulation_findings![0].similarity).toBe(1)
    // Named the way a методист would: ОПК-4.1 is an индикатор by its code,
    // even though this РПД's flat listing made the parser call it a competency.
    expect(result.formulation_findings![0].detail).toMatch(/повторяет индикатор ОПК-4\.1/)
    // The verdict line must carry it too — a clean coverage score alone was
    // exactly the false all-clear that was reported.
    expect(result.summary).toMatch(/дословно повторя/)
  })

  it('still flags it when the РПД nests the indicator under a parent competency', async () => {
    mockParseAndScore([{
      code: 'ОПК-4',
      title: 'Способен осуществлять технологический контроль пищевого производства',
      indicators: [{ code: 'ОПК-4.1', title: INDICATOR }],
    }])

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.formulation_findings).toHaveLength(1)
    expect(result.formulation_findings![0].indicator_code).toBe('ОПК-4.1')
  })

  it('leaves a genuine discipline-specific reformulation alone on the same shape', async () => {
    chatJSONMock
      .mockResolvedValueOnce({
        goals: [],
        competencies: [{ code: 'ОПК-4.1', title: INDICATOR, indicators: [] }],
        outcomes: {
          knowledge: ['температурные режимы и стадии тепловой обработки при приготовлении супов и соусов'],
          skills: [], mastery: [],
        },
        technologies: [],
        content: { practicals: 'Тепловая обработка: супы, соусы.' },
      })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.formulation_findings).toEqual([])
  })
})

// #2, requested 2026-08-24: «нужна еще проверка смысла, формулировки … и есть
// ли смысловая связь с дисциплиной». Copy-detection cannot answer this — a
// ЗУВ reworded past the containment threshold still needs reading.
describe('reviewSyllabus — meaning check and duplicate accounting', () => {
  const INDICATOR = 'Знает и понимает сущность технологических процессов производства кулинарной продукции для индустрии питания'
  const COPIED = 'сущность технологических процессов производства кулинарной продукции для индустрии питания'
  const GENERIC = 'современные подходы и методы решения профессиональных задач в отрасли'

  function mockReview(opts: { outcomes: unknown; meaning?: unknown; meaningRejects?: boolean }) {
    const chain = chatJSONMock
      .mockResolvedValueOnce({
        goals: [],
        competencies: [{ code: 'ОПК-4.1', title: INDICATOR, indicators: [] }],
        outcomes: opts.outcomes,
        technologies: [],
        content: { practicals: 'Умная кухня: датчики и электронные чек-листы.' },
      })
      .mockResolvedValueOnce({ items: [] })
    if (opts.meaningRejects) chain.mockRejectedValueOnce(new Error('provider unavailable'))
    else chain.mockResolvedValueOnce(opts.meaning ?? { items: [] })
  }

  it('surfaces a generic ЗУВ the copy check cannot catch', async () => {
    mockReview({
      outcomes: { knowledge: [GENERIC], skills: [], mastery: [] },
      meaning: { items: [{ ref: 'K0', indicator_code: 'ОПК-4.1', verdict: 'weak_link',
                           detail: 'Формулировка общая.', recommendation: 'Свяжите с темами дисциплины.' }] },
    })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.formulation_findings).toEqual([])          // not a copy
    expect(result.meaning_findings).toHaveLength(1)
    expect(result.meaning_findings![0].verdict).toBe('weak_link')
    expect(result.meaning_findings![0].indicator_code).toBe('ОПК-4.1')
    expect(result.summary).toMatch(/не раскрывает смысл индикатора/)
  })

  it('does not double-report a line the copy check already flagged', async () => {
    // The meaning pass must never even be asked about a verbatim copy.
    mockReview({ outcomes: { knowledge: [COPIED], skills: [], mastery: [] } })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.formulation_findings).toHaveLength(1)
    expect(result.meaning_findings).toEqual([])
    // Stronger than "no finding": with nothing left to judge, the model is
    // never called — no cost, no latency, no chance of a contradictory second
    // opinion on a line already reported.
    expect(chatJSONMock).toHaveBeenCalledTimes(2)
  })

  it('records a warning when the meaning pass fails, rather than reporting silence', async () => {
    mockReview({ outcomes: { knowledge: [GENERIC], skills: [], mastery: [] }, meaningRejects: true })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    // The distinction that matters: empty findings + a warning ≠ "all clear".
    expect(result.meaning_findings).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings![0]).toMatch(/не завершилась/)
  })

  it('counts a copied ЗУВ as a duplicate and says so in the verdict', async () => {
    mockReview({ outcomes: { knowledge: [COPIED], skills: [], mastery: [] } })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.duplicate_count).toBe(1)
    expect(result.summary).toMatch(/фактическое покрытие ниже/)
  })

  it('reports no duplicates when nothing was copied', async () => {
    mockReview({ outcomes: { knowledge: [GENERIC], skills: [], mastery: [] } })

    const result = await reviewSyllabus({ teacherId: 't1', syllabusText: 'x'.repeat(200) })

    expect(result.duplicate_count).toBe(0)
    expect(result.summary).not.toMatch(/фактическое покрытие ниже/)
  })
})
