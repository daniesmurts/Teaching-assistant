import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SlideContent from './SlideContent'
import type { Slide } from '../../types'

// «Скачать выбранные слайды». What matters here is not that checkboxes render
// but that the gestures a teacher actually makes produce the right selection —
// including shift-click over a long deck, which is the difference between
// three clicks and forty.

afterEach(cleanup)

vi.mock('../../hooks/usePlan', () => ({ usePlan: () => ({ can: () => true }) }))
vi.mock('../../store/uiStore', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ showUpgradeModal: vi.fn(), showSatisfaction: vi.fn() }),
}))

const slide = (title: string): Slide =>
  ({ type: 'bullets', title, notes: '', citations: [], body: { items: ['пункт'] } }) as unknown as Slide

const SLIDES = ['Первый', 'Второй', 'Третий', 'Четвёртый'].map(slide)

// SlideImagePicker (mounted inside every card) uses react-query, so the tree
// needs a client even though nothing here touches the network.
const withClient = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
)

function renderDeck(selected: number[] = []) {
  const onSelectionChange = vi.fn()
  render(withClient(
    <SlideContent
      slides={SLIDES}
      presentationId="p1"
      sources={[]}
      selectedSlides={new Set(selected)}
      onSelectionChange={onSelectionChange}
    />,
  ))
  const boxes = screen.getAllByRole('checkbox')
  return { onSelectionChange, boxes }
}

const picked = (fn: ReturnType<typeof vi.fn>) =>
  [...(fn.mock.calls[0][0] as Set<number>)].sort((a, b) => a - b)

describe('choosing slides to download', () => {
  it('gives every slide a checkbox', () => {
    expect(renderDeck().boxes).toHaveLength(4)
  })

  it('ticks the slide that was clicked', () => {
    const { onSelectionChange, boxes } = renderDeck()
    fireEvent.click(boxes[2])
    expect(picked(onSelectionChange)).toEqual([2])
  })

  it('unticks a slide that was already chosen', () => {
    const { onSelectionChange, boxes } = renderDeck([1, 2])
    fireEvent.click(boxes[1])
    expect(picked(onSelectionChange)).toEqual([2])
  })

  it('extends from the last click when shift is held', () => {
    const { onSelectionChange, boxes } = renderDeck()
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[3], { shiftKey: true })
    // The second call carries the range, anchored on the first click.
    expect([...(onSelectionChange.mock.calls[1][0] as Set<number>)].sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3])
  })

  it('shift-clicking adds rather than replacing, as in any file manager', () => {
    const { onSelectionChange, boxes } = renderDeck()
    fireEvent.click(boxes[3])
    fireEvent.click(boxes[1], { shiftKey: true })
    expect([...(onSelectionChange.mock.calls[1][0] as Set<number>)].sort((a, b) => a - b))
      .toEqual([1, 2, 3])
  })

  it('«Выбрать все» selects the whole deck', () => {
    const { onSelectionChange } = renderDeck()
    fireEvent.click(screen.getByText('Выбрать все'))
    expect(picked(onSelectionChange)).toEqual([0, 1, 2, 3])
  })

  it('shows the count on the download button, so a partial export is never a surprise', () => {
    renderDeck([0, 2])
    expect(screen.getByText('Скачать PPTX (2)')).toBeTruthy()
    expect(screen.getByText('Выбрано: 2')).toBeTruthy()
  })

  it('reads as an ordinary full export when nothing is ticked', () => {
    renderDeck()
    expect(screen.getByText('Скачать PPTX')).toBeTruthy()
  })

  it('«Снять» clears everything', () => {
    const { onSelectionChange } = renderDeck([0, 1])
    fireEvent.click(screen.getByText('Снять'))
    expect(picked(onSelectionChange)).toEqual([])
  })

  it('draws no checkboxes when the deck cannot be exported at all', () => {
    // A result rendered before it was persisted has no id to export from; a
    // checkbox there would lead nowhere.
    render(withClient(<SlideContent slides={SLIDES} sources={[]} />))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})
