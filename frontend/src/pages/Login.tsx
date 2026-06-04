import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useLogin } from '../hooks/useAuth'
import { authErrorMessage } from '../api/auth'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ email, password })
  }

  const errorMsg = login.isError ? authErrorMessage(login.error) : ''

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-ink tracking-tight">ИСПУМ</h1>
          <p className="font-sans text-sm text-ink-secondary mt-2">Войдите в свой аккаунт</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Эл. почта"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.ru"
              required
              autoFocus
            />
            <div>
              <Input
                label="Пароль"
                type="password"
                reveal
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
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

            {errorMsg && (
              <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                {errorMsg}
              </div>
            )}

            <Button type="submit" className="w-full" loading={login.isPending}>
              Войти
            </Button>
          </form>
        </div>

        <p className="text-center text-sm font-sans text-ink-secondary mt-4">
          Нет аккаунта?{' '}
          <Link to="/register" className="text-amber hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  )
}
