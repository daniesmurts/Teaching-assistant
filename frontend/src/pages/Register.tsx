import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useRegister } from '../hooks/useAuth'
import { validatePassword } from '../lib/validatePassword'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function Register() {
  const [form, setForm] = useState({
    name: '', university: '', phone: '', email: '', password: '',
  })
  const [tosAccepted, setTosAccepted] = useState(false)
  const [tosError, setTosError]       = useState(false)
  const [pwError, setPwError]         = useState<string | null>(null)
  const register = useRegister()

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const pw = validatePassword(form.password)
    setPwError(pw)
    if (pw) return

    if (!tosAccepted) { setTosError(true); return }
    setTosError(false)

    register.mutate(form)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-ink tracking-tight">ИСПУМ</h1>
          <p className="font-sans text-sm text-ink-secondary mt-2">Создайте аккаунт</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            <Input
              label="Полное имя"
              value={form.name}
              onChange={set('name')}
              placeholder="Иванов Иван Иванович"
            />

            <Input
              label="Университет / организация"
              value={form.university}
              onChange={set('university')}
              placeholder="МГУ им. М.В. Ломоносова"
            />

            <Input
              label="Телефон"
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+7 (___) ___-__-__"
            />

            <Input
              label="Эл. почта"
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@university.ru"
              required
              autoComplete="email"
            />

            <div>
              <Input
                label="Пароль"
                type="password"
                value={form.password}
                onChange={(e) => { set('password')(e); if (pwError) setPwError(null) }}
                placeholder="8+ символов, заглавная буква и цифра"
                required
                autoComplete="new-password"
              />
              {pwError && (
                <p className="mt-1 text-xs font-sans text-danger">{pwError}</p>
              )}
            </div>

            {/* TOS checkbox */}
            <div>
              <label className={`flex items-start gap-3 cursor-pointer select-none`}>
                <input
                  type="checkbox"
                  checked={tosAccepted}
                  onChange={(e) => { setTosAccepted(e.target.checked); setTosError(false) }}
                  className="mt-0.5 h-4 w-4 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-sans text-ink-secondary leading-relaxed">
                  Я принимаю{' '}
                  <Link
                    to="/terms"
                    target="_blank"
                    className="text-amber hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Условия использования
                  </Link>
                  {' '}и{' '}
                  <Link
                    to="/privacy"
                    target="_blank"
                    className="text-amber hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Политику конфиденциальности
                  </Link>
                  , в том числе обработку персональных данных в соответствии с ФЗ-152.
                </span>
              </label>
              {tosError && (
                <p className="mt-1.5 text-xs font-sans text-danger">
                  Необходимо принять условия для продолжения.
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={register.isPending}>
              Создать аккаунт
            </Button>

          </form>
        </div>

        <p className="text-center text-sm font-sans text-ink-secondary mt-4">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="text-amber hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  )
}
