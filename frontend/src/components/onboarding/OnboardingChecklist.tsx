import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCourses } from '../../api/courses'
import { getGradingStats } from '../../api/grading'
import { getPresentations } from '../../api/presentations'

const DISMISS_KEY = 'ga_onboarding_dismissed'

interface Step {
  done: boolean
  title: string
  desc: string
  to: string
  cta: string
}

export default function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  const { data: courses }       = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: stats }         = useQuery({ queryKey: ['grading-stats'], queryFn: getGradingStats })
  const { data: presentations } = useQuery({ queryKey: ['presentations'], queryFn: () => getPresentations() })

  // Wait for the data before deciding, to avoid a flash of an empty checklist.
  if (courses === undefined || stats === undefined || presentations === undefined) return null

  const steps: Step[] = [
    { done: courses.length > 0,       title: 'Создайте первый предмет',     desc: 'Предмет задаёт контекст для проверки работ и презентаций.', to: '/courses',       cta: 'Создать предмет' },
    { done: stats.total > 0,          title: 'Проверьте первую работу',     desc: 'Вставьте текст работы студента — ИСПУМ оценит её и даст разбор.', to: '/grading',       cta: 'Проверить работу' },
    { done: presentations.length > 0, title: 'Сгенерируйте презентацию',    desc: 'Получите структуру лекции по теме за минуту.',           to: '/presentations', cta: 'Создать презентацию' },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length

  // Keep the checklist present until the user has graded their first work — the
  // core "aha". Only then can it be dismissed. A brand-new user (no grades yet)
  // can't accidentally clear their only guidance into the 17-item menu.
  const canDismiss = stats.total > 0

  if (dismissed || allDone) return null

  const nextIdx = steps.findIndex((s) => !s.done)

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="bg-surface border border-amber-mid/30 rounded-lg mb-6 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-amber-light/40">
        <span className="text-amber text-sm">✦</span>
        <div className="flex-1">
          <div className="text-sm font-sans font-medium text-ink">С чего начать</div>
          <div className="text-xs font-sans text-ink-secondary">Пройдите 3 шага, чтобы освоить ИСПУМ</div>
        </div>
        <Link to="/help?video=first-steps" className="text-xs font-sans font-medium text-amber hover:underline flex-shrink-0">
          Смотреть видео
        </Link>
        <div className="text-xs font-sans font-medium text-ink-secondary">{doneCount} из {steps.length}</div>
        {canDismiss && (
          <button onClick={dismiss} title="Скрыть" className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none ml-1">×</button>
        )}
      </div>

      {/* progress bar */}
      <div className="h-1 bg-border">
        <div className="h-full bg-amber transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div>
        {steps.map((s, i) => {
          const isNext = i === nextIdx
          return (
            <div key={s.to} className={`flex items-center gap-3 px-5 py-3 ${i < steps.length - 1 ? 'border-b border-border' : ''} ${isNext ? 'bg-amber-light/20' : ''}`}>
              <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                s.done ? 'bg-success text-white' : isNext ? 'bg-amber text-white' : 'bg-border text-ink-tertiary'
              }`}>
                {s.done ? '✓' : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-sans ${s.done ? 'text-ink-tertiary line-through' : 'text-ink font-medium'}`}>{s.title}</div>
                {!s.done && <div className="text-xs font-sans text-ink-secondary mt-0.5">{s.desc}</div>}
              </div>
              {!s.done && (
                <Link
                  to={s.to}
                  className={`flex-shrink-0 text-xs font-sans font-medium px-3 py-1.5 rounded-md transition-colors ${
                    isNext ? 'bg-amber text-white hover:opacity-90' : 'text-amber hover:bg-amber-light'
                  }`}
                >
                  {s.cta} →
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
