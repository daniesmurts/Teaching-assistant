import { useState, useEffect, FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useRegister } from '../hooks/useAuth'
import { authErrorMessage, getInvite } from '../api/auth'
import { validatePassword } from '../lib/validatePassword'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

// Russian mobile mask → +7 (9XX) XXX-XX-XX. Drops a leading 8/7 (trunk/country
// code), forces the first national digit to 9 (RU mobile), and formats live.
function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('7') || d.startsWith('8')) d = d.slice(1)   // strip country/trunk code
  if (d.length > 0 && d[0] !== '9') d = '9' + d                // mobile always starts with 9
  d = d.slice(0, 10)
  if (!d) return ''
  let out = `+7 (${d.slice(0, 3)}`
  if (d.length > 3) out += `) ${d.slice(3, 6)}`
  if (d.length > 6) out += `-${d.slice(6, 8)}`
  if (d.length > 8) out += `-${d.slice(8, 10)}`
  return out
}

// Live password checklist — mirrors validatePassword / backend authValidation.
const PW_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'Не менее 8 символов', test: (p) => p.length >= 8 },
  { label: 'Заглавная буква (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { label: 'Цифра', test: (p) => /[0-9]/.test(p) },
]

function RuleIcon({ state }: { state: 'idle' | 'ok' | 'bad' }) {
  if (state === 'ok') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (state === 'bad') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    )
  }
  return <span className="inline-block w-[5px] h-[5px] rounded-full bg-current opacity-50" aria-hidden="true" />
}

export default function Register() {
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? undefined

  const [form, setForm] = useState({
    name: '', university: '', phone: '', email: '', password: '',
  })
  const [tosAccepted, setTosAccepted] = useState(false)
  const [tosError, setTosError]       = useState(false)
  const [pwError, setPwError]         = useState<string | null>(null)
  const register = useRegister()

  // If arriving via an institution invite, look it up and prefill/lock the email.
  const { data: invite } = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => getInvite(inviteToken!),
    enabled: !!inviteToken,
  })
  useEffect(() => {
    if (!invite?.valid) return
    setForm((f) => ({
      ...f,
      email:      invite.email          ?? f.email,
      // Prefill university with the institution name — they're joining it by
      // definition, so leaving the field empty just makes them retype it.
      university: invite.institution_name ?? f.university,
    }))
  }, [invite])
  const invited = invite?.valid === true

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

    register.mutate({ ...form, invite_token: inviteToken })
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
          <p className="font-sans text-[11px] text-ink-tertiary mt-1 leading-snug px-4">
            Интеллектуальная Система Проверки и Подготовки Учебных Материалов
          </p>
          <p className="font-sans text-sm text-ink-secondary mt-3">Создайте аккаунт</p>
        </div>

        {invited && (
          <div className="mb-4 px-4 py-3 bg-amber-light/60 border border-amber/20 rounded-lg text-center">
            <p className="text-sm font-sans text-ink">
              Вас пригласили в <strong>{invite?.institution_name ?? 'организацию'}</strong>
            </p>
            <p className="text-xs font-sans text-ink-secondary mt-0.5">
              Зарегистрируйтесь, чтобы присоединиться к команде.
            </p>
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            <Input
              label="Полное имя"
              value={form.name}
              onChange={set('name')}
              placeholder="Иванов Иван Иванович"
              required
            />

            <Input
              label="Университет / организация"
              value={form.university}
              onChange={set('university')}
              placeholder="МГУ им. М.В. Ломоносова"
              required
            />

            <Input
              label={<>Телефон <span className="font-normal text-ink-tertiary">· необязательно</span></>}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
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
                reveal
                onChange={(e) => { set('password')(e); if (pwError) setPwError(null) }}
                placeholder="8+ символов, заглавная буква и цифра"
                required
                autoComplete="new-password"
              />
              <ul className="mt-2 space-y-1">
                {PW_RULES.map((rule) => {
                  const empty = form.password.length === 0
                  const met   = rule.test(form.password)
                  const state = empty ? 'idle' : met ? 'ok' : 'bad'
                  const color = state === 'ok'
                    ? 'var(--color-success)'
                    : state === 'bad'
                      ? 'var(--color-danger)'
                      : 'var(--color-ink-tertiary)'
                  return (
                    <li key={rule.label} className="flex items-center gap-2 text-xs font-sans transition-colors" style={{ color }}>
                      <span className="w-3.5 flex items-center justify-center flex-shrink-0">
                        <RuleIcon state={state} />
                      </span>
                      <span>{rule.label}</span>
                    </li>
                  )
                })}
              </ul>
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

            {register.isError && (
              <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                {authErrorMessage(register.error)}
              </div>
            )}

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
          <span className="mx-2 text-ink-tertiary">·</span>
          <Link to="/" className="text-ink-secondary hover:text-amber transition-colors">
            На главную
          </Link>
        </p>
      </div>
    </div>
  )
}
