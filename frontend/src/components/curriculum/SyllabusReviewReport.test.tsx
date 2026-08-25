import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import SyllabusReviewReport from './SyllabusReviewReport'
import type {
  SyllabusReview, SyllabusCoverageItem, OutcomeFormulationFinding, OutcomeMeaningFinding,
} from '../../types'

// The 2026-08-24 report: a copied «должен знать» line showed a clean green
// «Обеспечена 90%», with the only warning parked in a block further up the
// page. These tests pin the fix — the caveat has to reach the card itself —
// and specifically guard the failure mode that would silently reintroduce
// the original bug: the item↔finding lookup is keyed on `kind::title`, so any
// drift between the two sides means no warning renders and nothing errors.

// vitest runs with `globals: false`, so Testing Library's automatic
// afterEach cleanup never registers — without this, each render leaks into
// the next test's document and queries match stale nodes.
afterEach(cleanup)

const COPIED = 'сущность технологических процессов производства кулинарной продукции для индустрии питания'
const INDICATOR = 'Знает и понимает сущность технологических процессов производства кулинарной продукции для индустрии питания'

function item(overrides: Partial<SyllabusCoverageItem> = {}): SyllabusCoverageItem {
  return {
    kind: 'knowledge', code: null, title: COPIED,
    status: 'covered', score: 90, sources: [], evidence: null,
    gap: '', recommendation: '',
    ...overrides,
  }
}

function finding(overrides: Partial<OutcomeFormulationFinding> = {}): OutcomeFormulationFinding {
  return {
    kind: 'copied_from_indicator',
    outcome_kind: 'knowledge',
    outcome_title: COPIED,
    indicator_code: 'ОПК-4.1',
    indicator_title: INDICATOR,
    similarity: 1,
    detail: 'Формулировка «Знать» дословно повторяет индикатор ОПК-4.1.',
    recommendation: 'Переформулируйте пункт «Знать» через содержание этой дисциплины.',
    ...overrides,
  }
}

function review(overrides: Partial<SyllabusReview> = {}): SyllabusReview {
  return {
    competencies_source: 'declared',
    goals_source: 'declared',
    parsed: null,
    items: [item()],
    formulation_findings: [finding()],
    summary: 'Содержание РПД полностью обеспечивает заявленные требования.',
    covered: 1, partial: 0, missing: 0,
    generated_at: new Date().toISOString(),
    ...overrides,
  } as SyllabusReview
}

describe('SyllabusReviewReport — formulation warning on the item card', () => {
  it('renders the warning on the very card that shows the green score', () => {
    render(<SyllabusReviewReport result={review()} />)

    // The flagged ЗУВ card must carry BOTH the coverage status and the caveat,
    // so «Обеспечена» can never be read on its own.
    const card = screen.getByText(COPIED).closest('div.rounded-lg') as HTMLElement
    expect(card).not.toBeNull()
    expect(within(card).getByText('Обеспечена')).toBeTruthy()
    expect(within(card).getByText('Повтор формулировки')).toBeTruthy()
    expect(within(card).getByText(/дословно повторяет индикатор ОПК-4\.1/)).toBeTruthy()
    expect(within(card).getByText(INDICATOR)).toBeTruthy()
  })

  it('does not mark cards that were not flagged', () => {
    const clean = review({
      items: [item({ title: 'температурные режимы тепловой обработки супов и соусов' })],
      formulation_findings: [],
    })
    render(<SyllabusReviewReport result={clean} />)

    expect(screen.queryByText('Повтор формулировки')).toBeNull()
  })

  it('does not attach the warning to a different ЗУВ line that merely shares a kind', () => {
    const mixed = review({
      items: [
        item({ title: COPIED }),
        item({ title: 'температурные режимы тепловой обработки супов и соусов' }),
      ],
    })
    render(<SyllabusReviewReport result={mixed} />)

    // Exactly one card flagged — the lookup must key on the title, not just kind.
    expect(screen.getAllByText('Повтор формулировки')).toHaveLength(1)
  })

  it('falls back to the standalone block when the flagged line has no card (requirement cap)', () => {
    // Parsed and flagged, but truncated out of the scored list — must not vanish.
    const truncated = review({ items: [item({ kind: 'competency', title: INDICATOR })] })
    render(<SyllabusReviewReport result={truncated} />)

    expect(screen.getByText('Формулировки результатов обучения')).toBeTruthy()
    expect(screen.getByText(/не вошли в разбор по разделам/)).toBeTruthy()
  })

  it('omits the standalone block entirely when every finding found its card', () => {
    render(<SyllabusReviewReport result={review()} />)
    expect(screen.queryByText('Формулировки результатов обучения')).toBeNull()
  })
})

// #2 (2026-08-24): the judged half. Same inline contract as the copy warning —
// the caveat has to reach the card that shows the score.
const GENERIC = 'современные подходы к решению профессиональных задач в отрасли'

function meaning(overrides: Partial<OutcomeMeaningFinding> = {}): OutcomeMeaningFinding {
  return {
    verdict: 'weak_link',
    outcome_kind: 'knowledge',
    outcome_title: GENERIC,
    indicator_code: 'ОПК-4.1',
    indicator_title: INDICATOR,
    detail: 'Формулировка слишком общая.',
    recommendation: 'Свяжите её с темами этой дисциплины.',
    ...overrides,
  }
}

describe('SyllabusReviewReport — meaning findings', () => {
  it('renders the meaning caveat on the card that shows the green score', () => {
    render(<SyllabusReviewReport result={review({
      items: [item({ title: GENERIC })],
      formulation_findings: [],
      meaning_findings: [meaning()],
    })} />)

    const card = screen.getByText(GENERIC).closest('div.rounded-lg') as HTMLElement
    expect(within(card).getByText('Обеспечена')).toBeTruthy()
    expect(within(card).getByText('Нет связи с дисциплиной')).toBeTruthy()
    expect(within(card).getByText('Формулировка слишком общая.')).toBeTruthy()
  })

  it('labels a not_reflected verdict differently from a weak link', () => {
    render(<SyllabusReviewReport result={review({
      items: [item({ title: GENERIC })],
      formulation_findings: [],
      meaning_findings: [meaning({ verdict: 'not_reflected' })],
    })} />)

    expect(screen.getByText('Не отражает индикатор')).toBeTruthy()
    expect(screen.queryByText('Нет связи с дисциплиной')).toBeNull()
  })

  it('omits the indicator block when the model could match none', () => {
    render(<SyllabusReviewReport result={review({
      items: [item({ title: GENERIC })],
      formulation_findings: [],
      meaning_findings: [meaning({ indicator_code: null, indicator_title: null })],
    })} />)

    expect(screen.getByText('Нет связи с дисциплиной')).toBeTruthy()
    expect(screen.queryByText(INDICATOR)).toBeNull()
  })

  it('states the duplicate inflation instead of silently adjusting the counts', () => {
    render(<SyllabusReviewReport result={review({ duplicate_count: 2 })} />)
    expect(screen.getByText(/2 — дословные повторы уже учтённых/)).toBeTruthy()
  })

  it('says nothing about duplicates when there are none', () => {
    render(<SyllabusReviewReport result={review({ duplicate_count: 0 })} />)
    expect(screen.queryByText(/дословные повторы уже учтённых/)).toBeNull()
  })

  it('shows a warning when a check did not finish, so silence is not read as all-clear', () => {
    render(<SyllabusReviewReport result={review({
      formulation_findings: [],
      meaning_findings: [],
      warnings: ['Проверка смысла формулировок не завершилась — повторите проверку.'],
    })} />)

    expect(screen.getByText(/не завершилась/)).toBeTruthy()
  })
})
