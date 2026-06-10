import { useState, FormEvent, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { resetPassword } from '../api/auth'
import { validatePassword } from '../lib/validatePassword'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import SuccessMark from '../components/ui/SuccessMark'

type PageState = 'form' | 'success' | 'invalid'

export default function ResetPassword() {
  const [searchParams]    = useSearchParams()
  const navigate          = useNavigate()
  const token             = searchParams.get('token') ?? ''

  const [state, setState]       = useState<PageState>(token ? 'form' : 'invalid')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // Auto-redirect to login after successful reset
  useEffect(() => {
    if (state !== 'success') return
    const timer = setTimeout(() => navigate('/login'), 3000)
    return () => clearTimeout(timer)
  }, [state, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }
    const pwError = validatePassword(password)
    if (pwError) {
      setError(pwError)
      return
    }

    setLoading(true)
    try {
      await resetPassword(token, password)
      setState('success')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error
        ?? 'Не удалось сбросить пароль. Попробуйте запросить новую ссылку.'
      setError(msg)

      // If the token was explicitly called invalid/expired, switch state
      if (msg.includes('недействительна') || msg.includes('устарела')) {
        setState('invalid')
      }
    } finally {
      setLoading(false)
    }
  }

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
          <p className="font-sans text-sm text-ink-secondary mt-2">Новый пароль</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">

          {/* ── Invalid / expired token ── */}
          {state === 'invalid' && (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="font-sans text-sm font-medium text-ink mb-2">
                Ссылка недействительна
              </h2>
              <p className="font-sans text-sm text-ink-secondary mb-4">
                Эта ссылка для сброса пароля истекла или уже использована.
              </p>
              <Link
                to="/forgot-password"
                className="text-amber text-sm hover:underline"
              >
                Запросить новую ссылку →
              </Link>
            </div>
          )}

          {/* ── Password form ── */}
          {state === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="font-sans text-sm text-ink-secondary">
                Введите новый пароль для вашего аккаунта.
              </p>
              <Input
                label="Новый пароль"
                type="password"
                reveal
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ символов, заглавная буква и цифра"
                required
                autoFocus
              />
              <Input
                label="Повторите пароль"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
              {error && (
                <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" loading={loading}>
                Установить пароль
              </Button>
            </form>
          )}

          {/* ── Success ── */}
          {state === 'success' && (
            <div className="text-center py-4">
              <SuccessMark />
              <h2 className="font-sans text-sm font-medium text-ink mb-2">
                Пароль успешно изменён
              </h2>
              <p className="font-sans text-sm text-ink-secondary">
                Перенаправляем на страницу входа…
              </p>
            </div>
          )}

        </div>

        {state !== 'success' && (
          <p className="text-center text-sm font-sans text-ink-secondary mt-4">
            <Link to="/login" className="text-amber hover:underline">
              ← Вернуться ко входу
            </Link>
            <span className="mx-2 text-ink-tertiary">·</span>
            <Link to="/" className="text-ink-secondary hover:text-amber transition-colors">
              На главную
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
