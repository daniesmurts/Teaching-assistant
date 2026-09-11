import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FeatureIntro from './FeatureIntro'
import ReadingGuide, { GuideText, GuideTerm } from './ReadingGuide'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const intro = (props: Partial<React.ComponentProps<typeof FeatureIntro>> = {}) =>
  render(
    <MemoryRouter>
      <FeatureIntro id="test" title="Что можно сделать" description="Описание" {...props} />
    </MemoryRouter>,
  )

describe('FeatureIntro — capabilities', () => {
  it('lists actions without numbering them', () => {
    // Numbered circles say «do these in this order», which is wrong for a set
    // of things a page can do — and wrong in a way a newcomer would believe.
    intro({ actions: [
      { label: 'Править слайд', text: 'изменить текст и заметки' },
      { label: 'Раздатка',      text: 'PDF для студентов' },
    ] })

    expect(screen.getByText('Править слайд')).toBeTruthy()
    expect(screen.getByText('Раздатка')).toBeTruthy()
    expect(document.querySelector('ol')).toBeNull()
    expect(document.querySelectorAll('ul li')).toHaveLength(2)
  })

  it('still numbers `steps`, which really are a sequence', () => {
    intro({ steps: ['Сначала', 'Потом'] })
    expect(document.querySelector('ol')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('stays collapsed once dismissed, and says how to reopen', () => {
    intro({ actions: [{ label: 'Раздатка', text: 'PDF' }] })
    fireEvent.click(screen.getByText('Скрыть'))

    expect(screen.queryByText('Раздатка')).toBeNull()
    expect(screen.getByText('Как это работает?')).toBeTruthy()
    expect(localStorage.getItem('feat_intro_test')).toBe('collapsed')
  })

  it('opens collapsed for a teacher who dismissed it before', () => {
    localStorage.setItem('feat_intro_test', 'collapsed')
    intro({ actions: [{ label: 'Раздатка', text: 'PDF' }] })
    expect(screen.queryByText('Раздатка')).toBeNull()
  })
})

describe('ReadingGuide', () => {
  it('renders its title and body as an aside next to the thing it explains', () => {
    render(
      <ReadingGuide title="Как читать таблицу">
        <GuideText>Цвет точки — это <GuideTerm>не оценка</GuideTerm>.</GuideText>
      </ReadingGuide>,
    )
    expect(screen.getByText('Как читать таблицу')).toBeTruthy()
    expect(screen.getByText('не оценка')).toBeTruthy()
    expect(document.querySelector('aside')).toBeTruthy()
  })

  it('has nothing to dismiss — the question comes back whenever the artefact does', () => {
    render(<ReadingGuide title="Что это"><GuideText>Пояснение</GuideText></ReadingGuide>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
