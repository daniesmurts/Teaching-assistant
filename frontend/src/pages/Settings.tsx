import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/layout/TopBar'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'
import { deleteAccount } from '../api/account'

const CONFIRM_WORD = 'УДАЛИТЬ'

export default function Settings() {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const addToast  = useUIStore((s) => s.addToast)
  const navigate  = useNavigate()

  const [open, setOpen]         = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleDelete() {
    setError('')
    if (confirm !== CONFIRM_WORD) { setError(`Введите «${CONFIRM_WORD}» для подтверждения`); return }
    if (!password)               { setError('Введите пароль'); return }

    setLoading(true)
    try {
      await deleteAccount(password)
      clearAuth()
      addToast('Аккаунт удалён', 'success')
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
        ?? 'Не удалось удалить аккаунт'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Настройки" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">

          {/* Account info */}
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Аккаунт
            </div>
            <dl className="space-y-2 text-sm font-sans">
              <div className="flex justify-between"><dt className="text-ink-secondary">Имя</dt><dd className="text-ink">{teacher?.name ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-secondary">Эл. почта</dt><dd className="text-ink">{teacher?.email}</dd></div>
              {teacher?.university && (
                <div className="flex justify-between"><dt className="text-ink-secondary">Организация</dt><dd className="text-ink">{teacher.university}</dd></div>
              )}
            </dl>
          </div>

          {/* Danger zone */}
          <div className="border border-danger/30 rounded-lg overflow-hidden">
            <div className="bg-danger-bg px-5 py-3 border-b border-danger/20">
              <div className="text-sm font-sans font-semibold text-danger">Опасная зона</div>
            </div>
            <div className="p-5">
              <div className="text-sm font-sans font-medium text-ink mb-1">Удалить аккаунт</div>
              <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-4">
                Удаление аккаунта необратимо. Все ваши данные — курсы, рубрики, проверенные работы,
                презентации, загруженные документы и история платежей — будут безвозвратно удалены
                в соответствии с ФЗ-152 «О персональных данных».
              </p>

              {!open ? (
                <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
                  Удалить аккаунт
                </Button>
              ) : (
                <div className="space-y-3 max-w-sm">
                  <Input
                    label="Текущий пароль"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <Input
                    label={`Введите «${CONFIRM_WORD}» для подтверждения`}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={CONFIRM_WORD}
                  />
                  {error && (
                    <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">{error}</div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" loading={loading} onClick={handleDelete}>
                      Удалить навсегда
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => { setOpen(false); setError(''); setPassword(''); setConfirm('') }}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
