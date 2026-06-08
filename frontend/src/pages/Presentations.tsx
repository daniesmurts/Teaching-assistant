import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import PresentationForm from '../components/presentations/PresentationForm'
import SlideContent from '../components/presentations/SlideContent'
import Button from '../components/ui/Button'
import { getPresentations, deletePresentation, type GenerateResponse } from '../api/presentations'
import { useUIStore } from '../store/uiStore'
import type { Presentation } from '../types'

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
        <div className="flex items-center gap-2">
          {p.lecture_number && (
            <span className="text-[10px] font-sans font-semibold bg-amber-light text-amber px-1.5 py-0.5 rounded-sm uppercase tracking-wide flex-shrink-0">
              Лекция {p.lecture_number}
            </span>
          )}
          <span className="text-sm font-sans font-medium text-ink truncate">{p.topic}</span>
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
  }

  const displayContent = result?.generated_content ?? openHistory?.generated_content ?? null
  const displayTitle   = openHistory?.topic ?? null

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Презентации"
        actions={
          (result || openHistory) ? (
            <button
              onClick={reset}
              className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors"
            >
              ← Новая презентация
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[960px] mx-auto px-6 py-6 space-y-6">

          {!result && !openHistory && (
            <FeatureIntro
              id="presentations"
              title="Генератор презентаций — структура лекции за минуту"
              description="Опишите параметры лекции (тема, длительность, цели, уровень аудитории), и ИИ построит её послайдово: заголовки, тезисы и заметки для выступления. Это готовый текст — скопируйте его в PowerPoint, Google Slides или Canva."
              steps={[
                'Выберите курс и задайте тему лекции, её длительность и учебные цели.',
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
                </>
              )}
            </div>
          )}

          {/* Viewing a historical presentation */}
          {openHistory && (
            <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-sans text-ink-tertiary mb-0.5">Просмотр презентации</div>
                <div className="text-sm font-sans font-medium text-ink">{openHistory.topic}</div>
              </div>
              <Button
                size="sm"
                variant="danger"
                loading={deleteMut.isPending}
                onClick={() => deleteMut.mutate(openHistory.id)}
              >
                Удалить
              </Button>
            </div>
          )}

          {/* Generated slides */}
          {displayContent && (
            <div className="result-appear">
              {displayTitle && !result && (
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-4">
                  {displayTitle}
                </div>
              )}
              <SlideContent content={displayContent} />
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
