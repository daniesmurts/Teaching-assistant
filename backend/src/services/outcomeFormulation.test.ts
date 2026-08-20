import { describe, it, expect } from 'vitest'
import { findCopiedOutcomeFormulations, containment, contentTokens } from './outcomeFormulation'

// The primary case is taken verbatim from the РПД a методист reviewed on
// 2026-08-20 — the one the coverage check scored 100% «Обеспечена» while the
// «должен знать» line was nothing but indicator ОПК-4.1 with its verb prefix
// removed. If this check ever stops flagging THIS pair, it has regressed to
// the behaviour that was reported as a bug.
const OPK_4_1 = {
  code: 'ОПК-4.1',
  title: 'Знает и понимает сущность технологических процессов производства кулинарной продукции для индустрии питания',
}
const OPK_4_3 = {
  code: 'ОПК-4.3',
  title: 'Владеет навыками работы с существующей нормативно-технической документацией в профессиональной деятельности, в т.ч. при разработке технологической документации',
}

const NO_OUTCOMES = { knowledge: [], skills: [], mastery: [] }

describe('findCopiedOutcomeFormulations — the reported defect', () => {
  it('flags a «Знать» line that is the indicator with its verb prefix stripped', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_1], {
      ...NO_OUTCOMES,
      knowledge: ['сущность технологических процессов производства кулинарной продукции для индустрии питания'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('copied_from_indicator')
    expect(findings[0].outcome_kind).toBe('knowledge')
    expect(findings[0].indicator_code).toBe('ОПК-4.1')
    expect(findings[0].similarity).toBe(1)
    expect(findings[0].detail).toMatch(/дословно повторяет индикатор ОПК-4\.1/)
  })

  // The «почти дословно» half of the report: the phrase is lifted from the
  // indicator but re-cased to fit a «Знать:» list. Exact-token matching alone
  // would miss this; stemming is what keeps it caught.
  it('flags a line copied from the indicator but re-inflected to fit the list', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_1], {
      ...NO_OUTCOMES,
      knowledge: ['сущность технологические процессы производство кулинарной продукции для индустрии питания'],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].indicator_code).toBe('ОПК-4.1')
  })

  it('flags a «Владеть» line copied from a «Владеет навыками …» indicator', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_3], {
      ...NO_OUTCOMES,
      mastery: ['навыками работы с существующей нормативно-технической документацией в профессиональной деятельности'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].outcome_kind).toBe('mastery')
  })

  it('points at the indicator the line was actually copied from, not just the first one', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_1, OPK_4_3], {
      ...NO_OUTCOMES,
      mastery: ['навыками работы с существующей нормативно-технической документацией в профессиональной деятельности'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].indicator_code).toBe('ОПК-4.3')
  })
})

describe('findCopiedOutcomeFormulations — what must NOT be flagged', () => {
  // The методист's rule is that a ЗУВ line must convey the indicator's
  // meaning through the discipline's own content. A genuine reformulation
  // reuses the subject's vocabulary and must stay silent, or the check just
  // becomes noise on every well-written РПД.
  it('leaves a genuine discipline-specific reformulation alone', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_1], {
      ...NO_OUTCOMES,
      knowledge: [
        'температурные режимы и стадии тепловой обработки при приготовлении супов, соусов и горячих закусок',
      ],
    })
    expect(findings).toEqual([])
  })

  it('ignores items too short for an overlap ratio to mean anything', () => {
    const findings = findCopiedOutcomeFormulations([OPK_4_1], {
      ...NO_OUTCOMES,
      knowledge: ['основы технологии'],
    })
    expect(findings).toEqual([])
  })

  it('returns nothing when the РПД declares no indicators (РПД-студия path)', () => {
    const findings = findCopiedOutcomeFormulations([], {
      ...NO_OUTCOMES,
      knowledge: ['сущность технологических процессов производства кулинарной продукции'],
    })
    expect(findings).toEqual([])
  })
})

describe('contentTokens', () => {
  it('strips the leading indicator verb frame so the comparison sees only subject matter', () => {
    // Stems, not surface forms — see RU_ENDINGS for why.
    expect(contentTokens('Знает и понимает сущность процессов')).toEqual(['сущност', 'процесс'])
    expect(contentTokens('Владеет навыками работы с документацией')).toEqual(['работ', 'документац'])
  })

  it('normalises ё and punctuation so they cannot mask a copy', () => {
    expect(contentTokens('учёт, контроль!')).toEqual(contentTokens('учет контроль'))
  })

  it('collapses inflections of the same word to one stem', () => {
    expect(contentTokens('производство')).toEqual(contentTokens('производства'))
    expect(contentTokens('технологических процессов')).toEqual(contentTokens('технологические процессы'))
  })
})

describe('containment', () => {
  it('is 1 when the shorter item adds no vocabulary of its own', () => {
    expect(containment('производство кулинарной продукции', OPK_4_1.title)).toBe(1)
  })

  it('is low for two formulations about genuinely different subject matter', () => {
    expect(containment('температурные режимы тепловой обработки супов', OPK_4_1.title)).toBeLessThan(0.5)
  })
})
