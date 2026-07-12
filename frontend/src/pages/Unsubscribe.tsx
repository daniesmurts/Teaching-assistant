import { useState } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import Button from '../components/ui/Button'
import { unsubscribeFromMarketingEmails } from '../api/marketingUnsubscribe'

// Fallback unsubscribe path for one-off marketing broadcasts sent through a
// tool that can't do per-recipient merge links (one static link for
// everyone) — the teacher types their own email here instead of clicking a
// pre-tokenised link. See routes/auth.ts's POST /marketing-unsubscribe.
export default function Unsubscribe() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await unsubscribeFromMarketingEmails(email)
      setSubmitted(true)
    } catch {
      // Global error toast (client.ts) already surfaced the failure.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[480px] mx-auto w-full px-6 py-16 md:py-24">
        <h1 className="font-display text-3xl font-bold mb-4 text-center">Отписаться от рассылки</h1>

        {submitted ? (
          <div className="bg-success-bg border border-success p-8 rounded-xl text-center">
            <div className="w-12 h-12 bg-success text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">✓</div>
            <h3 className="font-bold text-lg mb-2 text-success">Готово</h3>
            <p className="text-sm text-success/80">
              Если этот адрес зарегистрирован у нас, он отписан от писем о новых функциях.
              Письма о безопасности аккаунта и оплате продолжат приходить.
            </p>
          </div>
        ) : (
          <>
            <p className="text-ink-secondary text-center mb-8">
              Укажите email, на который приходят наши письма о новых функциях —
              мы отпишем его от этой рассылки.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  id="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                  placeholder="ivan@university.edu"
                />
              </div>
              <Button type="submit" loading={submitting} className="w-full">
                Отписаться
              </Button>
            </form>
          </>
        )}
      </main>

      <PublicFooter />
    </div>
  )
}
