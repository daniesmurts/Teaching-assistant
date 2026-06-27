import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { useUIStore } from '../../store/uiStore'
import {
  getInstitutions, createInstitution, updateInstitution, type AdminInstitution,
  getSamlConfig, updateSamlConfig, type SamlConfig,
} from '../../api/admin'

const PLANS = ['institution', 'pro', 'free']
const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function AdminInstitutions() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [planTier, setPlanTier] = useState('institution')
  const [maxTeachers, setMaxTeachers] = useState('')
  const [emailDomain, setEmailDomain] = useState('')

  const { data: institutions = [] } = useQuery({ queryKey: ['admin-institutions'], queryFn: getInstitutions })

  const createMut = useMutation({
    mutationFn: () => createInstitution({
      name: name.trim(), planTier,
      maxTeachers: maxTeachers.trim() === '' ? null : Number(maxTeachers),
      emailDomain: emailDomain.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-institutions'] })
      setShowForm(false); setName(''); setPlanTier('institution'); setMaxTeachers(''); setEmailDomain('')
      addToast('Организация создана', 'success')
    },
    onError: () => addToast('Не удалось создать организацию', 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateInstitution>[1] }) => updateInstitution(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-institutions'] }),
    onError:   () => addToast('Не удалось обновить организацию', 'error'),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  const inputClass = 'px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Организации</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Создавайте организации и назначайте администраторов на странице «Преподаватели»
            </p>
          </div>
          {!showForm && <CreateButton onClick={() => setShowForm(true)}>Новая организация</CreateButton>}
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <input className={`${inputClass} w-full`} placeholder="Название организации" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <select className={inputClass} value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input className={`${inputClass} w-40`} type="number" min={1} placeholder="Мест (пусто = ∞)" value={maxTeachers} onChange={(e) => setMaxTeachers(e.target.value)} />
              <input className={`${inputClass} flex-1`} placeholder="Домен авто-входа (напр. mgu.ru)" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={createMut.isPending} disabled={!name.trim()}>Создать</Button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">Отмена</button>
            </div>
          </form>
        )}

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                <th className="text-left px-4 py-2 font-medium">Организация</th>
                <th className="text-left px-4 py-2 font-medium">Тариф</th>
                <th className="text-left px-4 py-2 font-medium">Домен</th>
                <th className="text-right px-4 py-2 font-medium">Мест</th>
                <th className="text-right px-4 py-2 font-medium">Преподавателей</th>
                <th className="text-right px-4 py-2 font-medium">Создана</th>
                <th className="text-right px-4 py-2 font-medium">SSO</th>
              </tr>
            </thead>
            <tbody>
              {institutions.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-tertiary text-xs">Организаций пока нет.</td></tr>
              ) : (
                institutions.map((inst) => <Row key={inst.id} inst={inst} onPatch={(data) => updateMut.mutate({ id: inst.id, data })} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Row({ inst, onPatch }: { inst: AdminInstitution; onPatch: (data: { planTier?: string; maxTeachers?: number | null; emailDomain?: string | null }) => void }) {
  const [showSaml, setShowSaml] = useState(false)
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-2.5 text-ink font-medium">{inst.name}</td>
        <td className="px-4 py-2.5">
          <select
            value={inst.plan_tier}
            onChange={(e) => onPatch({ planTier: e.target.value })}
            className="text-xs font-sans bg-surface border border-border rounded-md px-2 py-1"
          >
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </td>
        <td className="px-4 py-2.5">
          <input
            defaultValue={inst.email_domain ?? ''}
            placeholder="—"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== (inst.email_domain ?? '')) onPatch({ emailDomain: v || null })
            }}
            className="w-32 text-xs font-sans bg-surface border border-border rounded-md px-2 py-1"
          />
        </td>
        <td className="px-4 py-2.5 text-right">
          <input
            type="number" min={1}
            defaultValue={inst.max_teachers ?? ''}
            placeholder="∞"
            onBlur={(e) => {
              const v = e.target.value.trim()
              const next = v === '' ? null : Number(v)
              if (next !== inst.max_teachers) onPatch({ maxTeachers: next })
            }}
            className="w-16 text-xs font-sans bg-surface border border-border rounded-md px-2 py-1 text-right"
          />
        </td>
        <td className="px-4 py-2.5 text-right text-ink">{inst.teacher_count}</td>
        <td className="px-4 py-2.5 text-right text-ink-tertiary text-xs">{fmt(inst.created_at)}</td>
        <td className="px-4 py-2.5 text-right">
          <button
            onClick={() => setShowSaml((s) => !s)}
            className={`text-xs font-sans px-2 py-1 rounded-md border transition-colors ${
              showSaml
                ? 'border-amber text-amber bg-amber-light'
                : 'border-border-mid text-ink-secondary hover:bg-surface-warm'
            }`}
          >
            {showSaml ? 'Скрыть' : 'Настроить'}
          </button>
        </td>
      </tr>
      {showSaml && (
        <tr className="border-b border-border last:border-0 bg-surface-warm">
          <td colSpan={7} className="px-4 py-4">
            <SamlPanel institutionId={inst.id} institutionName={inst.name} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── SAML config panel ──────────────────────────────────────────────────────

function SamlPanel({ institutionId, institutionName }: { institutionId: string; institutionName: string }) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['admin-saml', institutionId],
    queryFn:  () => getSamlConfig(institutionId),
  })

  if (isLoading || !cfg) {
    return <div className="text-xs font-sans text-ink-tertiary py-2">Загрузка конфигурации SAML…</div>
  }
  return <SamlForm institutionId={institutionId} institutionName={institutionName} cfg={cfg} qc={qc} addToast={addToast} />
}

function SamlForm({
  institutionId, institutionName, cfg, qc, addToast,
}: {
  institutionId: string
  institutionName: string
  cfg: SamlConfig
  qc: ReturnType<typeof useQueryClient>
  addToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [enabled, setEnabled]   = useState(cfg.saml_enabled)
  const [entityId, setEntityId] = useState(cfg.saml_idp_entity_id ?? '')
  const [ssoUrl, setSsoUrl]     = useState(cfg.saml_idp_sso_url ?? '')
  const [cert, setCert]         = useState(cfg.saml_idp_x509_cert ?? '')
  const [attrEmail, setAttrEmail] = useState(cfg.saml_attribute_email)
  const [attrName, setAttrName]   = useState(cfg.saml_attribute_name)

  const saveMut = useMutation({
    mutationFn: () => updateSamlConfig(institutionId, {
      saml_enabled:         enabled,
      saml_idp_entity_id:   entityId.trim() || null,
      saml_idp_sso_url:     ssoUrl.trim() || null,
      saml_idp_x509_cert:   cert.trim() || null,
      saml_attribute_email: attrEmail.trim() || 'email',
      saml_attribute_name:  attrName.trim() || 'displayName',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-saml', institutionId] })
      addToast('Конфигурация SAML сохранена', 'success')
    },
    onError: () => addToast('Не удалось сохранить конфигурацию', 'error'),
  })

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => addToast(`${label} скопирован`, 'success'),
      () => addToast('Не удалось скопировать', 'error'),
    )
  }

  const field = 'w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'
  const label = 'block text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5'

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* ── Left: what the IdP admin enters on our side ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-sans text-sm font-medium text-ink">Настройки IdP — {institutionName}</h3>
          <label className="flex items-center gap-2 text-xs font-sans text-ink-secondary cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Включить SSO
          </label>
        </div>

        <div>
          <label className={label}>IdP Entity ID</label>
          <input className={field} value={entityId} onChange={(e) => setEntityId(e.target.value)}
            placeholder="https://idp.university.ru/saml/metadata" />
        </div>
        <div>
          <label className={label}>IdP SSO URL</label>
          <input className={field} value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)}
            placeholder="https://idp.university.ru/saml/sso" />
        </div>
        <div>
          <label className={label}>Сертификат IdP (X.509 PEM)</label>
          <textarea className={`${field} font-mono text-xs h-28`} value={cert} onChange={(e) => setCert(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Атрибут эл. почты</label>
            <input className={field} value={attrEmail} onChange={(e) => setAttrEmail(e.target.value)} placeholder="email" />
          </div>
          <div>
            <label className={label}>Атрибут имени</label>
            <input className={field} value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="displayName" />
          </div>
        </div>

        <Button onClick={() => saveMut.mutate()} loading={saveMut.isPending}>Сохранить</Button>
      </div>

      {/* ── Right: what we give the IdP admin to configure their side ── */}
      <div className="space-y-4">
        <h3 className="font-sans text-sm font-medium text-ink">Данные для IdP организации</h3>
        <p className="text-xs font-sans text-ink-secondary leading-relaxed">
          Передайте эти значения ИТ-специалисту организации, чтобы они зарегистрировали
          ИСПУМ как Service Provider в своей системе единого входа.
        </p>

        <CopyField label="SP Entity ID" value={cfg.spEntityId ?? '—'} onCopy={copy} />
        <CopyField label="ACS URL (Assertion Consumer Service)" value={cfg.acsUrl} onCopy={copy} />
        <CopyField label="SP Metadata URL" value={cfg.metadataUrl} onCopy={copy} />

        <a
          href={cfg.metadataUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-sans text-amber hover:underline"
        >
          Открыть метаданные SP (XML) →
        </a>
      </div>
    </div>
  )
}

function CopyField({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string, l: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value}
          className="flex-1 px-3 py-2 text-xs font-mono bg-surface border border-border rounded-md text-ink-secondary" />
        <button
          onClick={() => onCopy(value, label)}
          className="px-3 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-xs hover:bg-surface transition-colors flex-shrink-0"
        >
          Копировать
        </button>
      </div>
    </div>
  )
}
