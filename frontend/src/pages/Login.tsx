import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useLogin } from '../hooks/useAuth'
import { authErrorMessage, discoverSso } from '../api/auth'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { getApiBaseUrl } from '../lib/runtimeConfig'

const API_BASE = getApiBaseUrl()

// Two-step login: enter email → we ask the backend whether this domain uses
// SSO. SAML domains are redirected to their IdP; everyone else sees the
// password field. Mirrors the Google / Microsoft / Slack login pattern.
type Step = 'email' | 'password'

export default function Login() {
  const [step, setStep]         = useState<Step>('email')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const login = useLogin()

  async function handleContinue(e: FormEvent) {
    e.preventDefault()
    setDiscoverError('')
    setDiscovering(true)
    try {
      const result = await discoverSso(email)
      if (result.method === 'saml') {
        // Full-page redirect to the backend, which 302s to the university IdP.
        window.location.assign(`${API_BASE}${result.loginUrl}`)
        return // keep the spinner up while the browser navigates away
      }
      setStep('password')
    } catch (err) {
      setDiscoverError(authErrorMessage(err))
    } finally {
      setDiscovering(false)
    }
  }

  function handleLogin(e: FormEvent) {
    e.preventDefault()
    login.mutate({ email, password })
  }

  function backToEmail() {
    setStep('email')
    setPassword('')
    login.reset()
  }

  const loginError = login.isError ? authErrorMessage(login.error) : ''
  // saml_force_sso safety-net rejection (backend/src/routes/auth.ts) — rare:
  // /discover already routes SSO-configured domains away from this form
  // before it's ever shown. Carries a real login URL, so offer it as a link
  // rather than a dead-end error.
  const loginErrorData = login.isError
    ? (login.error as { response?: { data?: { code?: string; ssoLoginUrl?: string } } }).response?.data
    : undefined
  const ssoRequiredUrl = loginErrorData?.code === 'SSO_REQUIRED' ? loginErrorData.ssoLoginUrl : undefined

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link
            to="/"
            title="ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов"
            className="inline-block font-display text-3xl font-bold text-ink tracking-tight hover:text-amber transition-colors"
          >
            ИСПУМ
          </Link>
          <p className="font-sans text-[11px] text-ink-tertiary mt-1 leading-snug px-4">
            Интеллектуальная Система Проверки и Подготовки Учебных Материалов
          </p>
          <p className="font-sans text-sm text-ink-secondary mt-3">Войдите в свой аккаунт</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          {step === 'email' ? (
            <form onSubmit={handleContinue} className="space-y-4">
              <Input
                label="Эл. почта"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.ru"
                required
                autoFocus
              />

              {discoverError && (
                <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                  {discoverError}
                </div>
              )}

              <Button type="submit" className="w-full" loading={discovering}>
                Продолжить
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Show which email we're signing in, with a way back */}
              <button
                type="button"
                onClick={backToEmail}
                className="flex items-center gap-1.5 text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
              >
                <span aria-hidden>←</span>
                <span className="truncate max-w-[16rem]">{email}</span>
              </button>

              <div>
                <Input
                  label="Пароль"
                  type="password"
                  reveal
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoFocus
                />
                <div className="text-right mt-1">
                  <Link
                    to="/forgot-password"
                    className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
                  >
                    Забыли пароль?
                  </Link>
                </div>
              </div>

              {loginError && (
                <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                  {loginError}
                  {ssoRequiredUrl && (
                    <a
                      href={`${API_BASE}${ssoRequiredUrl}`}
                      className="block mt-1.5 font-medium text-amber hover:underline"
                    >
                      Войти через SSO →
                    </a>
                  )}
                </div>
              )}

              <Button type="submit" className="w-full" loading={login.isPending}>
                Войти
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm font-sans text-ink-secondary mt-4">
          Нет аккаунта?{' '}
          <Link to="/register" className="text-amber hover:underline">
            Зарегистрироваться
          </Link>
          <span className="mx-2 text-ink-tertiary">·</span>
          <Link to="/" className="text-ink-secondary hover:text-amber transition-colors">
            На главную
          </Link>
        </p>
      </div>
    </div>
  )
}
