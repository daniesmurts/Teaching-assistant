import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/layout/TopBar'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'
import { deleteAccount, downloadAccountExport, updateProfileName } from '../api/account'

const CONFIRM_WORD = 'УДАЛИТЬ'

export default function Settings() {
  const teacher       = useAuthStore((s) => s.teacher)
  const plan          = useAuthStore((s) => s.plan)
  const updateAccount = useAuthStore((s) => s.updateAccount)
  const clearAuth     = useAuthStore((s) => s.clearAuth)
  const addToast      = useUIStore((s) => s.addToast)
  const navigate      = useNavigate()

  const [open, setOpen]         = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // Name edit — inline on the account row. State stays local until Save.
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft]     = useState('')
  const [nameSaving, setNameSaving]   = useState(false)

  function startNameEdit() {
    setNameDraft(teacher?.name ?? '')
    setNameEditing(true)
  }
  async function saveName() {
    const trimmed = nameDraft.trim()
    if (trimmed.length < 2)   { addToast('Имя должно содержать минимум 2 символа', 'error'); return }
    if (trimmed.length > 100) { addToast('Имя не длиннее 100 символов', 'error'); return }
    if (trimmed === teacher?.name) { setNameEditing(false); return }

    setNameSaving(true)
    try {
      const updated = await updateProfileName(trimmed)
      if (teacher && plan) updateAccount({ ...teacher, name: updated.name }, plan)
      addToast('Имя обновлено', 'success')
      setNameEditing(false)
    } catch {
      // Axios interceptor handles the toast.
    } finally {
      setNameSaving(false)
    }
  }

  // Export — both toggles default OFF per the privacy decision.
  const [includeSubmissions, setIncludeSubmissions] = useState(false)
  const [includeSyllabuses,  setIncludeSyllabuses]  = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      await downloadAccountExport({
        include_submissions: includeSubmissions,
        include_syllabuses:  includeSyllabuses,
      })
      addToast('Файл экспорта скачан', 'success')
    } catch {
      // Axios interceptor handles the toast.
    } finally {
      setExporting(false)
    }
  }

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
              <div className="flex justify-between items-center gap-3">
                <dt className="text-ink-secondary flex-shrink-0">Имя</dt>
                {nameEditing ? (
                  <dd className="flex items-center gap-2 flex-1 justify-end">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  saveName()
                        if (e.key === 'Escape') { setNameEditing(false); setNameDraft('') }
                      }}
                      maxLength={100}
                      className="flex-1 max-w-[280px] text-sm font-sans bg-surface border border-border-strong rounded-md px-2 py-1 outline-none"
                    />
                    <Button size="sm" loading={nameSaving} onClick={saveName}>Сохранить</Button>
                    <button
                      onClick={() => { setNameEditing(false); setNameDraft('') }}
                      className="text-xs font-sans text-ink-secondary hover:text-ink px-1.5 py-1"
                    >
                      Отмена
                    </button>
                  </dd>
                ) : (
                  <dd className="flex items-center gap-3">
                    <span className="text-ink">{teacher?.name ?? '—'}</span>
                    <button
                      onClick={startNameEdit}
                      className="text-xs font-sans text-amber hover:underline"
                    >
                      Изменить
                    </button>
                  </dd>
                )}
              </div>
              <div className="flex justify-between"><dt className="text-ink-secondary">Эл. почта</dt><dd className="text-ink">{teacher?.email}</dd></div>
              {teacher?.university && (
                <div className="flex justify-between"><dt className="text-ink-secondary">Организация</dt><dd className="text-ink">{teacher.university}</dd></div>
              )}
            </dl>
          </div>

          {/* Export */}
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Экспорт данных
            </div>
            <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-4">
              Скачайте копию своих предметов, критериев, рубрик и утверждённых проверок в формате JSON.
              Имена студентов автоматически обезличиваются.{' '}
              <a href="/help?slug=account-export" className="text-amber hover:underline">Что входит в экспорт?</a>
            </p>

            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSubmissions}
                  onChange={(e) => setIncludeSubmissions(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-sans text-ink leading-relaxed">
                  Включить тексты работ студентов <span className="text-ink-tertiary">(имена остаются обезличенными)</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSyllabuses}
                  onChange={(e) => setIncludeSyllabuses(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-sans text-ink leading-relaxed">
                  Включить программы предметов
                </span>
              </label>
            </div>

            <Button size="sm" loading={exporting} onClick={handleExport}>
              Скачать экспорт
            </Button>
          </div>

          {/* Danger zone */}
          <div className="border border-danger/30 rounded-lg overflow-hidden">
            <div className="bg-danger-bg px-5 py-3 border-b border-danger/20">
              <div className="text-sm font-sans font-semibold text-danger">Опасная зона</div>
            </div>
            <div className="p-5">
              <div className="text-sm font-sans font-medium text-ink mb-1">Удалить аккаунт</div>
              <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-4">
                Удаление аккаунта необратимо. Все ваши данные — предметы, рубрики, проверенные работы,
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
