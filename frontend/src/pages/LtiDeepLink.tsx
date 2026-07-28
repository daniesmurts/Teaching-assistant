import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getMe } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import Button from '../components/ui/Button'
import {
  getDeepLinkSession, selectDeepLink, type LtiDeepLinkSessionInfo,
} from '../api/lti'

/**
 * Content-item picker shown when a teacher adds GradeAssist as a Moodle
 * activity ("External tool" → Deep Linking flow). Reached via a 302 from
 * POST /api/lti/launch (backend/src/routes/lti.ts), which already set the
 * HttpOnly session cookie on the redirect, carrying a short-lived `session`
 * id (lti_deep_link_sessions).
 *
 * On selection, the backend mints a signed LtiDeepLinkingResponse and this
 * page auto-submits it back to Moodle's deep_link_return_url as a real form
 * POST (not fetch/XHR) — Moodle expects a top-level navigation carrying the
 * `JWT` field, then redirects the teacher back into their course with the
 * new activity created.
 */
export default function LtiDeepLink() {
  const [params] = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)
  const ran = useRef(false)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'submitting' | 'error'>('loading')
  const [session, setSession] = useState<LtiDeepLinkSessionInfo | null>(null)
  const [picked, setPicked] = useState<string>('')
  const [newTitle, setNewTitle] = useState('')

  const sessionId = params.get('session')

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    if (!sessionId) { setPhase('error'); return }

    getMe()
      .then(({ teacher, plan, draftKeySeed }) => {
        setAuth(teacher, plan, draftKeySeed)
        return getDeepLinkSession(sessionId)
      })
      .then((info) => { setSession(info); setPhase('ready') })
      .catch(() => setPhase('error'))
  }, [params, sessionId, setAuth])

  async function submit() {
    if (!sessionId) return
    setPhase('submitting')
    try {
      const result = await selectDeepLink(sessionId, picked ? { publishedAssignmentId: picked } : { newTitle })
      // Real form POST — Moodle's return endpoint expects a browser
      // navigation carrying the JWT, not an XHR response.
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = result.deepLinkReturnUrl
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'JWT'
      input.value = result.jwt
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
    } catch {
      setPhase('error')
    }
  }

  if (phase === 'loading') {
    return <Centered><Spinner label="Загрузка…" /></Centered>
  }

  if (phase === 'error') {
    return (
      <Centered>
        <div className="bg-surface border border-border rounded-lg p-6 max-w-sm text-center">
          <h1 className="font-display text-xl font-bold text-ink mb-2">Не удалось загрузить</h1>
          <p className="font-sans text-sm text-ink-secondary">
            Сессия настройки истекла или недействительна. Вернитесь в Moodle и добавьте элемент курса заново.
          </p>
        </div>
      </Centered>
    )
  }

  if (phase === 'submitting') {
    return <Centered><Spinner label="Возврат в Moodle…" /></Centered>
  }

  const canSubmit = Boolean(picked || newTitle.trim())

  return (
    <Centered>
      <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full">
        <h1 className="font-display text-xl font-bold text-ink mb-1">Выберите задание для ИСПУМ</h1>
        {session?.contextTitle && (
          <p className="font-sans text-xs text-ink-tertiary mb-4">Курс Moodle: {session.contextTitle}</p>
        )}

        {session && session.publishedAssignments.length > 0 && (
          <div className="space-y-2 mb-4">
            {session.publishedAssignments.map((a) => (
              <label
                key={a.id}
                className={`flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm font-sans ${
                  picked === a.id ? 'border-amber bg-amber-light/30' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="published-assignment"
                  checked={picked === a.id}
                  onChange={() => { setPicked(a.id); setNewTitle('') }}
                />
                {a.title}
              </label>
            ))}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
            Или создайте новое задание
          </label>
          <input
            type="text"
            className="w-full border border-border rounded-md px-3 py-2 text-sm font-sans"
            placeholder="Название нового задания"
            value={newTitle}
            onChange={(e) => { setNewTitle(e.target.value); setPicked('') }}
          />
        </div>

        <Button className="w-full" disabled={!canSubmit} onClick={submit}>
          Добавить в Moodle
        </Button>
      </div>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      {children}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-border border-t-amber rounded-full animate-spin" />
      <p className="font-sans text-sm text-ink-secondary">{label}</p>
    </div>
  )
}
