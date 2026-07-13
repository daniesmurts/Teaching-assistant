import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { resendVerificationEmail } from '../../api/auth'

// Gentle nag shown until the teacher confirms their email address (deferred
// verification — signup is never gated on it). Strict `=== false` check:
// a session cached before the field existed reads `undefined` and gets no
// banner until the next /me refresh settles it. Dismissal is per-mount, so
// the banner returns on the next full page load — deliberate: the address
// being unverified means password recovery won't work, which is worth a
// recurring reminder without being a modal.
export default function EmailVerifyBanner() {
  const teacher = useAuthStore((s) => s.teacher)
  const [dismissed, setDismissed] = useState(false)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle')

  if (dismissed || teacher?.email_verified !== false) return null

  const resend = async () => {
    setSendState('sending')
    try {
      await resendVerificationEmail()
      setSendState('sent')
    } catch {
      setSendState('idle')
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber/10 border-b border-amber/20 text-sm font-sans text-ink">
      <span className="flex-1">
        Подтвердите адрес эл. почты — ссылка в приветственном письме. Без
        подтверждения не получится восстановить пароль.
      </span>
      {sendState === 'sent' ? (
        <span className="text-success whitespace-nowrap">Письмо отправлено</span>
      ) : (
        <button
          onClick={resend}
          disabled={sendState === 'sending'}
          className="whitespace-nowrap font-medium text-amber hover:underline disabled:opacity-50"
        >
          Отправить ещё раз
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Скрыть"
        className="opacity-50 hover:opacity-100 text-base leading-none"
      >
        ×
      </button>
    </div>
  )
}
