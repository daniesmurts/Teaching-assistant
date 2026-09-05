import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import PresentationForm from '../components/presentations/PresentationForm'
import SlideContent from '../components/presentations/SlideContent'
import DeckQuizPanel from '../components/presentations/DeckQuizPanel'
import ImportPptx from '../components/presentations/ImportPptx'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Icon from '../components/ui/Icon'
import { tagColorClasses } from '../lib/tagColor'
import {
  getPresentations, deletePresentation, updateSlide, regenerateSlide, deleteSlide,
  insertSlide, moveSlide, setPresentationApproved, setPresentationScope,
  getSharedPresentations, type GenerateResponse,
} from '../api/presentations'
import { useUIStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import type { Presentation, Slide } from '../types'
import type { SlideEditActions } from '../components/presentations/SlideContent'

// ─── History list ─────────────────────────────────────────────────────────────

function HistoryItem({
  p,
  onOpen,
  onDelete,
  deleting,
}: {
  p: Presentation
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {p.course_name && (
            <Badge className={`flex-shrink-0 max-w-[40%] ${tagColorClasses(p.course_id ?? p.course_name)}`}>
              {p.course_name}
            </Badge>
          )}
          {p.lecture_number && (
            <span className="text-[10px] font-sans font-semibold bg-amber-light text-amber px-1.5 py-0.5 rounded-sm uppercase tracking-wide flex-shrink-0">
              Лекция {p.lecture_number}
            </span>
          )}
          <span className="text-sm font-sans font-medium text-ink truncate min-w-0 flex-1">{p.topic}</span>
        </div>
        <div className="text-xs font-sans text-ink-tertiary mt-0.5">
          {p.duration_minutes && `${p.duration_minutes} мин · `}
          {new Date(p.created_at).toLocaleDateString('ru-RU')}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={onOpen}>Открыть</Button>
        <Button size="sm" variant="danger" loading={deleting} onClick={onDelete}>Удалить</Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Presentations() {
  const qc = useQueryClient()
  const addToast = useUIStore(s => s.addToast)
  const myTeacherId = useAuthStore(s => s.teacher?.id)

  const [result, setResult]         = useState<GenerateResponse | null>(null)
  const [formCollapsed, setFormCollapsed] = useState(false)
  const [openHistory, setOpenHistory] = useState<Presentation | null>(null)

  const { data: list = [] } = useQuery({
    queryKey: ['presentations'],
    queryFn: () => getPresentations(),
  })

  const deleteMut = useMutation({
    mutationFn: deletePresentation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['presentations'] })
      addToast('Презентация удалена', 'success')
      if (openHistory) setOpenHistory(null)
    },
    onError: () => addToast('Не удалось удалить презентацию', 'error'),
  })

  function handleResult(res: GenerateResponse) {
    setResult(res)
    setOpenHistory(null)
    setFormCollapsed(true)
    qc.invalidateQueries({ queryKey: ['presentations'] })
  }

  function reset() {
    setResult(null)
    setOpenHistory(null)
    setFormCollapsed(false)
    setLocalSlides(null)
  }

  // Image picks mutate persisted slides; we mirror the change locally so the
  // renderer updates without a full refetch. Cleared when the viewer closes.
  const [localSlides, setLocalSlides] = useState<Slide[] | null>(null)
  useEffect(() => {
    setLocalSlides(result?.slides ?? openHistory?.slides ?? null)
  }, [result, openHistory])

  // ── Slide-level editing (TODO.md "### AO" Phase 1) ────────────────────────
  //
  // Every mutation returns the whole updated presentation, so the viewer
  // re-renders from what was actually stored rather than from a locally
  // patched guess. One in-flight mutation at a time (`slideBusy`) — these are
  // whole-array writes, and two overlapping ones would race on the same deck.
  const [slideBusy, setSlideBusy] = useState(false)

  async function runSlideAction(action: () => Promise<Presentation>, failure: string) {
    if (slideBusy) return
    setSlideBusy(true)
    try {
      const updated = await action()
      setLocalSlides(updated.slides ?? [])
      // Keep the open history row in step, so closing and reopening the deck
      // doesn't snap back to the pre-edit version.
      setOpenHistory((h) => (h && h.id === updated.id ? updated : h))
      qc.invalidateQueries({ queryKey: ['presentations'] })
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(message ?? failure, 'error')
    } finally {
      setSlideBusy(false)
    }
  }

  const displayPresentationId =
    result?.presentation_id ?? openHistory?.id ?? ''

  // «Готово» (TODO.md "### AO" Phase 2) — the consent gate for the flywheel.
  // Approving a deck is what lets ИСПУМ use its slides as a style reference
  // for this teacher's later lectures; nothing is shared with anyone else.
  const approved = Boolean(openHistory?.approved_at)
  const approveMut = useMutation({
    mutationFn: (next: boolean) => setPresentationApproved(displayPresentationId, next),
    onSuccess: (updated) => {
      setOpenHistory((h) => (h && h.id === updated.id ? updated : h))
      qc.invalidateQueries({ queryKey: ['presentations'] })
      addToast(updated.approved_at ? 'Лекция отмечена как готовая' : 'Отметка снята', 'success')
    },
    onError: () => addToast('Не удалось сохранить отметку', 'error'),
  })

  // Кафедральный банк (migration 123). Sharing needs a УМУ grant on the
  // кафедра, exactly as promoting a document does — so a plain teacher sees
  // the button, tries it, and gets a clear "нужен домен УМУ" answer rather
  // than a control that silently does nothing. Hiding it entirely would leave
  // no way to discover the bank exists.
  // A deck opened from the кафедра shelf is a colleague's. Every write below
  // is owner-scoped server-side, so offering the controls would only produce
  // errors — and «Удалить» on someone else's lecture should not even look
  // possible. Read-only is the honest presentation of what the viewer can do
  // with it.
  const isMine = !openHistory || !myTeacherId || openHistory.teacher_id === myTeacherId
  const shared = openHistory?.visibility_scope === 'unit'
  const shareMut = useMutation({
    mutationFn: (next: 'private' | 'unit') => setPresentationScope(displayPresentationId, next),
    onSuccess: (updated) => {
      setOpenHistory((h) => (h && h.id === updated.id ? updated : h))
      qc.invalidateQueries({ queryKey: ['presentations'] })
      qc.invalidateQueries({ queryKey: ['presentations-shared'] })
      addToast(updated.visibility_scope === 'unit' ? 'Лекция в банке кафедры' : 'Лекция снова только ваша', 'success')
    },
    onError: (err: unknown) => {
      const res = (err as { response?: { status?: number; data?: { error?: string } } }).response
      addToast(res?.data?.error ?? 'Не удалось изменить доступ', 'error')
    },
  })

  // The кафедра shelf — only rendered when a colleague has actually shared
  // something, so a teacher without an org unit never sees an empty promise.
  const { data: sharedDecks = [] } = useQuery({
    queryKey: ['presentations-shared'],
    queryFn: getSharedPresentations,
  })

  const slideEdit: SlideEditActions = {
    busy: slideBusy,
    onSave: (idx, slide) =>
      void runSlideAction(() => updateSlide(displayPresentationId, idx, slide), 'Не удалось сохранить слайд'),
    onRegenerate: (idx, instruction) =>
      void runSlideAction(() => regenerateSlide(displayPresentationId, idx, instruction || undefined), 'Не удалось переписать слайд'),
    onDelete: (idx) =>
      void runSlideAction(() => deleteSlide(displayPresentationId, idx), 'Не удалось удалить слайд'),
    onMove: (idx, to) =>
      void runSlideAction(() => moveSlide(displayPresentationId, idx, to), 'Не удалось переместить слайд'),
    onInsert: (afterIdx) =>
      void runSlideAction(() => insertSlide(displayPresentationId, afterIdx, 'bullets', 'Новый слайд'), 'Не удалось добавить слайд'),
  }
  const displaySlides   = localSlides
  const displayContent  = result?.generated_content ?? openHistory?.generated_content ?? null
  const displaySources  = result?.sources ?? openHistory?.sources ?? []
  const displayTitle    = openHistory?.topic ?? null

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Презентации"
        actions={
          (result || openHistory) ? (
            <Button size="sm" variant="secondary" onClick={reset}>
              ← Новая презентация
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[960px] mx-auto px-6 py-6 space-y-6">

          {!result && !openHistory && (
            <FeatureIntro
              id="presentations"
              videoSlug="presentations"
              title="Генератор презентаций — структура лекции за минуту"
              description="Опишите параметры лекции (тема, длительность, цели, уровень аудитории), и ИСПУМ построит её послайдово: заголовки, тезисы и заметки для выступления. Это готовый текст — скопируйте его в PowerPoint, Google Slides или Canva."
              steps={[
                'Выберите предмет и задайте тему лекции, её длительность и учебные цели.',
                'Сгенерируйте структуру — каждый слайд с пунктами и заметками для докладчика.',
                'Копируйте слайды по одному и вставляйте в любой редактор презентаций.',
              ]}
            />
          )}

          {/* Form section */}
          {!openHistory && (
            <div>
              {formCollapsed ? (
                <button
                  onClick={() => setFormCollapsed(false)}
                  className="flex items-center gap-2 text-xs font-sans text-ink-secondary hover:text-amber transition-colors mb-4"
                >
                  <span className="text-base leading-none">▸</span> Показать форму
                </button>
              ) : (
                <>
                  {result && (
                    <button
                      onClick={() => setFormCollapsed(true)}
                      className="flex items-center gap-2 text-xs font-sans text-ink-secondary hover:text-amber transition-colors mb-3"
                    >
                      <span className="text-base leading-none">▾</span> Скрыть форму
                    </button>
                  )}
                  <PresentationForm onResult={handleResult} />
                  <div className="mt-4">
                    <ImportPptx onImported={(p) => { setOpenHistory(p); setResult(null); setFormCollapsed(true) }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Viewing a historical presentation */}
          {openHistory && (
            <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs font-sans text-ink-tertiary mb-0.5">Просмотр презентации</div>
                <div className="text-sm font-sans font-medium text-ink">{openHistory.topic}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!isMine && (
                  <span className="text-xs font-sans text-ink-tertiary">
                    Лекция коллеги — только просмотр
                  </span>
                )}
                {isMine && <>
                <button
                  onClick={() => approveMut.mutate(!approved)}
                  disabled={approveMut.isPending}
                  title={approved
                    ? 'ИСПУМ ориентируется на эту лекцию как на образец вашего стиля. Нажмите, чтобы снять отметку.'
                    : 'Отметьте, если лекция получилась как надо — ИСПУМ будет ориентироваться на её стиль в следующих лекциях (ваших, никому не передаётся)'}
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-md border shadow-sm text-xs font-sans font-medium transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                    approved
                      ? 'bg-amber-light border-amber text-amber'
                      : 'bg-surface border-border-mid text-ink-secondary hover:bg-surface-warm hover:text-amber'
                  }`}
                >
                  <Icon name="check" size={14} />
                  {approved ? 'Готово — образец стиля' : 'Отметить «Готово»'}
                </button>
                <button
                  onClick={() => shareMut.mutate(shared ? 'private' : 'unit')}
                  disabled={shareMut.isPending}
                  title={shared
                    ? 'Лекция видна коллегам по кафедре и может служить образцом стиля для их лекций. Нажмите, чтобы убрать из банка.'
                    : 'Положить готовую лекцию в банк кафедры: коллеги смогут её открыть, а ИСПУМ — ориентироваться на неё. Нужны права УМУ на кафедру.'}
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-md border shadow-sm text-xs font-sans font-medium transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                    shared
                      ? 'bg-amber-light border-amber text-amber'
                      : 'bg-surface border-border-mid text-ink-secondary hover:bg-surface-warm hover:text-amber'
                  }`}
                >
                  <Icon name="users" size={14} />
                  {shared ? 'В банке кафедры' : 'В банк кафедры'}
                </button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(openHistory.id)}
                >
                  Удалить
                </Button>
                </>}
              </div>
            </div>
          )}

          {/* Generated slides */}
          {(displaySlides || displayContent) && (
            <div className="result-appear">
              {displayTitle && !result && (
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-4">
                  {displayTitle}
                </div>
              )}
              {/* Лекция → тест → аудитория (TODO.md "### AO" Phase 3). Above
                  the slides: the check on the lecture is the next thing the
                  teacher does with it, not a footnote after 30 cards. Only for
                  a persisted deck with typed slides — a legacy text row has
                  nothing to build questions from. */}
              {displayPresentationId && displaySlides && displaySlides.length > 0 && (
                <DeckQuizPanel presentationId={displayPresentationId} />
              )}

              <SlideContent
                slides={displaySlides}
                content={displayContent ?? undefined}
                sources={displaySources}
                presentationId={displayPresentationId}
                onSlidesChange={setLocalSlides}
                edit={isMine ? slideEdit : undefined}
              />
            </div>
          )}

          {/* Кафедральный банк — colleagues' shared lectures. Above the personal
              history on purpose: it is the part a teacher does not already
              know about. */}
          {!displayContent && sharedDecks.length > 0 && (
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                Лекции кафедры
              </div>
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                {sharedDecks.map((p) => (
                  <div key={p.id} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {p.course_name && (
                          <Badge className={`flex-shrink-0 max-w-[40%] ${tagColorClasses(p.course_id ?? p.course_name)}`}>
                            {p.course_name}
                          </Badge>
                        )}
                        <span className="text-sm font-sans font-medium text-ink truncate min-w-0 flex-1">{p.topic}</span>
                      </div>
                      <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                        Поделились с кафедрой · {new Date(p.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => { setOpenHistory(p); setResult(null); setFormCollapsed(true) }}>
                      Открыть
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History — only shown when no active result */}
          {!displayContent && list.length > 0 && (
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                История презентаций
              </div>
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                {list.map(p => (
                  <HistoryItem
                    key={p.id}
                    p={p}
                    onOpen={() => { setOpenHistory(p); setResult(null); setFormCollapsed(true) }}
                    onDelete={() => deleteMut.mutate(p.id)}
                    deleting={deleteMut.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!displayContent && list.length === 0 && (
            <div className="text-center py-12">
              <div className="font-display text-5xl text-ink-tertiary mb-3">▤</div>
              <p className="font-sans text-sm text-ink-secondary">
                Заполните форму выше и нажмите <strong>Создать презентацию</strong>.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
