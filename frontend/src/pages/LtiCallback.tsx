import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMe } from '../api/auth'
import { useAuthStore } from '../store/authStore'

// Landing page after a successful LTI launch from Moodle. Mirrors
// SsoCallback.tsx exactly — the backend already set the HttpOnly session
// cookie on the redirect that brought us here, and carries
// ?courseId=<uuid> (the course auto-resolved/created from the Moodle
// context), so the teacher lands directly in the grading view for the
// course they launched from.
export default function LtiCallback() {
  const [params] = useSearchParams()
  const setAuth  = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const courseId = params.get('courseId')

    getMe()
      .then(({ teacher, plan, draftKeySeed }) => {
        setAuth(teacher, plan, draftKeySeed)
        const dest = courseId ? `/grading?courseId=${courseId}` : '/dashboard'
        window.location.assign(dest)
      })
      .catch(() => setError(true))
  }, [params, setAuth])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <div className="bg-surface border border-border rounded-lg p-6">
            <h1 className="font-display text-xl font-bold text-ink mb-2">Не удалось войти</h1>
            <p className="font-sans text-sm text-ink-secondary mb-4">
              Запуск из Moodle не удался. Попробуйте открыть инструмент заново.
            </p>
            <Link
              to="/login"
              className="inline-block px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Вернуться ко входу
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-border border-t-amber rounded-full animate-spin" />
            <p className="font-sans text-sm text-ink-secondary">Выполняется вход из Moodle…</p>
          </div>
        )}
      </div>
    </div>
  )
}
