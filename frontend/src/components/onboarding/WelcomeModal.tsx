import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { nameForGreeting } from '../../lib/teacherName'

const WELCOMED_KEY = 'ga_welcomed'

// Three capability groups — enough to set accurate expectations (the app does
// more than "grading + slides"), but grouped so a day-one user isn't handed the
// full 17-item menu up front. One primary action: create a subject.
const GROUPS = [
  {
    glyph: '✦',
    title: 'Проверка работ',
    desc: 'Оценка студенческих работ с ИИ — разбор по критериям и обратная связь. Итоговое решение всегда за вами.',
  },
  {
    glyph: '▤',
    title: 'Учебные материалы',
    desc: 'Презентации, тесты и темы работ — готовая структура по вашей теме за минуту.',
  },
  {
    glyph: '▦',
    title: 'Аналитика',
    desc: 'Прогресс студентов, анализ учебного плана и постепенное обучение ИИ на ваших оценках.',
  },
]

export default function WelcomeModal() {
  const navigate = useNavigate()
  const teacher = useAuthStore((s) => s.teacher)
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(WELCOMED_KEY) !== '1' } catch { return false }
  })

  if (!open) return null

  function close() {
    try { localStorage.setItem(WELCOMED_KEY, '1') } catch { /* ignore */ }
    setOpen(false)
  }
  function start() { close(); navigate('/courses') }

  const greetName = nameForGreeting(teacher?.name)

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5">
          <div className="text-3xl mb-3">👋</div>
          <h2 className="font-display text-2xl font-bold text-ink tracking-tight">
            Добро пожаловать{greetName ? `, ${greetName}` : ''}!
          </h2>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed mt-2">
            ИСПУМ — помощник преподавателя. Коротко, что он умеет:
          </p>

          <div className="mt-4 space-y-2.5">
            {GROUPS.map((g) => (
              <div key={g.title} className="flex gap-3">
                <span className="text-amber text-sm mt-0.5">{g.glyph}</span>
                <div>
                  <div className="text-sm font-sans font-medium text-ink">{g.title}</div>
                  <div className="text-xs font-sans text-ink-secondary">{g.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 px-3 py-2.5 bg-amber-light/50 border border-amber/20 rounded-lg">
            <p className="text-xs font-sans text-ink-secondary">
              <span className="font-medium text-ink">С чего начать:</span> создайте предмет — он задаёт контекст почти для всех функций. Дальше вас проведёт чек-лист на главной.
            </p>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={start}
            className="flex-1 px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Создать первый предмет →
          </button>
          <button
            onClick={close}
            className="px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors"
          >
            Осмотреться
          </button>
        </div>
      </div>
    </div>
  )
}
