import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/auth'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import SuccessMark from '../components/ui/SuccessMark'

export default function ForgotPassword() {
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await forgotPassword(email)
      setSent(true)
    } catch {
      // Even on network errors show success — prevents email enumeration
      setSent(true)
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
          <p className="font-sans text-sm text-ink-secondary mt-2">Сброс пароля</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          {sent ? (
            /* Success state — same message regardless of whether email exists */
            <div className="text-center py-4">
              <SuccessMark />
              <h2 className="font-sans text-sm font-medium text-ink mb-2">
                Проверьте почту
              </h2>
              <p className="font-sans text-sm text-ink-secondary">
                Если этот адрес зарегистрирован, письмо со ссылкой для сброса пароля
                будет отправлено в течение нескольких минут.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="font-sans text-sm text-ink-secondary">
                Введите адрес эл. почты — мы отправим ссылку для сброса пароля.
              </p>
              <Input
                label="Эл. почта"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.ru"
                required
                autoFocus
              />
              {error && (
                <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" loading={loading}>
                Отправить ссылку
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm font-sans text-ink-secondary mt-4">
          <Link to="/login" className="text-amber hover:underline">
            ← Вернуться ко входу
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
