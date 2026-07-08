import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getLtiConfig, updateLtiConfig, testLtiConnection, getLtiRegistrationLink,
  listLtiCourseLinks, setLtiCourseLinkOrgUnit, type LtiConfigPatch, type LtiCourseLink,
} from '../../api/lti'
import { getOrgStructure } from '../../api/orgStructure'
import { buildTree, TYPE_LABEL, type TreeNode } from '../../lib/orgTree'

/**
 * Settings → Organisation → LTI. Self-serve platform registration (issuer,
 * client ID, deployment IDs, platform endpoints) so an institution's IT admin
 * can connect Moodle without ИСПУМ staff involvement — unlike SAML, which is
 * currently edited by platform-admin on the customer's behalf.
 *
 * Setup form + Test connection, plus course mapping (linking Moodle contexts
 * to org_units for institutional reporting rollups — purely additive, an
 * unmapped course still works fine since courses auto-create on first
 * teacher launch). Activity log is a still-later milestone.
 */
export default function InstitutionLti() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data, isLoading } = useQuery({ queryKey: ['institution-lti'], queryFn: getLtiConfig })
  const { data: courseLinks } = useQuery({ queryKey: ['institution-lti-course-links'], queryFn: listLtiCourseLinks })
  const [mappingLink, setMappingLink] = useState<LtiCourseLink | null>(null)

  const mapMut = useMutation({
    mutationFn: ({ id, orgUnitId }: { id: string; orgUnitId: string | null }) => setLtiCourseLinkOrgUnit(id, orgUnitId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institution-lti-course-links'] })
      addToast('Сопоставление сохранено', 'success')
      setMappingLink(null)
    },
    onError: () => addToast('Не удалось сохранить сопоставление', 'error'),
  })

  const [form, setForm] = useState<LtiConfigPatch>({})
  useEffect(() => {
    if (data) {
      setForm({
        lti_enabled:                 data.lti_enabled,
        lti_platform_issuer:         data.lti_platform_issuer,
        lti_platform_client_id:      data.lti_platform_client_id,
        lti_platform_deployment_ids: data.lti_platform_deployment_ids,
        lti_platform_auth_login_url: data.lti_platform_auth_login_url,
        lti_platform_auth_token_url: data.lti_platform_auth_token_url,
        lti_platform_jwks_url:       data.lti_platform_jwks_url,
      })
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: (patch: LtiConfigPatch) => updateLtiConfig(patch),
    onSuccess: (fresh) => {
      qc.setQueryData(['institution-lti'], fresh)
      addToast('Настройки LTI сохранены', 'success')
    },
    onError: () => addToast('Не удалось сохранить настройки', 'error'),
  })

  const testMut = useMutation({ mutationFn: testLtiConnection })

  const [registrationLink, setRegistrationLink] = useState<string | null>(null)
  const registrationLinkMut = useMutation({
    mutationFn: getLtiRegistrationLink,
    onSuccess: ({ url }) => setRegistrationLink(url),
    onError: () => addToast('Не удалось создать ссылку регистрации', 'error'),
  })

  if (isLoading || !data) {
    return <div className="px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div>
  }

  function field<K extends keyof LtiConfigPatch>(key: K, value: LtiConfigPatch[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const deploymentIdsText = (form.lti_platform_deployment_ids ?? []).join('\n')

  return (
    <div className="px-6 py-6 max-w-3xl">
      <h1 className="font-display text-2xl font-bold text-ink mb-2">LTI / LMS</h1>
      <p className="text-xs font-sans text-ink-tertiary mb-6 max-w-prose leading-relaxed">
        Подключите Moodle (или другую LMS с поддержкой LTI 1.3) — преподаватели смогут открывать
        ИСПУМ прямо из курса, без отдельного входа, а оценки будут автоматически возвращаться в журнал LMS.
      </p>

      <div className="bg-surface-warm border border-border rounded-md p-4 mb-6">
        <div className="text-sm font-sans font-semibold text-ink mb-1">Динамическая регистрация (рекомендуется)</div>
        <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-3">
          Если Moodle поддерживает LTI 1.3 Advantage, это быстрее ручного заполнения полей ниже.
        </p>
        {!registrationLink ? (
          <Button
            variant="secondary"
            onClick={() => registrationLinkMut.mutate()}
            loading={registrationLinkMut.isPending}
          >
            Получить ссылку регистрации
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-surface border border-border rounded-md px-2 py-1.5 break-all">{registrationLink}</code>
              <button
                onClick={() => navigator.clipboard.writeText(registrationLink).then(() => addToast('Ссылка скопирована', 'success'))}
                className="text-xs font-sans font-medium text-amber hover:opacity-80 transition-opacity flex-shrink-0"
              >
                Скопировать
              </button>
            </div>
            <p className="text-xs font-sans text-ink-tertiary leading-relaxed">
              Вставьте эту ссылку в Moodle: Site Administration → Plugins → External tool → Manage tools →
              Configure a tool → Dynamic registration.
            </p>
          </div>
        )}
      </div>

      <div className="bg-surface-warm border border-border rounded-md p-4 mb-6 text-xs font-sans text-ink-secondary leading-relaxed space-y-1">
        <div className="font-semibold text-ink mb-1">Данные для ручной регистрации инструмента в Moodle</div>
        <Row label="Redirect URI (Launch URL)" value={data.launch_url} />
        <Row label="URL входа (OIDC)" value={data.login_url} />
        <Row label="Public JWKS URL" value={data.jwks_url} />
      </div>

      <div className="space-y-4 mb-6">
        <label className="flex items-center gap-2 text-sm font-sans text-ink">
          <input
            type="checkbox"
            checked={form.lti_enabled ?? false}
            onChange={(e) => field('lti_enabled', e.target.checked)}
          />
          Включить LTI для этой организации
        </label>

        <TextField
          label="Issuer платформы"
          placeholder="https://moodle.example.ru"
          value={form.lti_platform_issuer ?? ''}
          onChange={(v) => field('lti_platform_issuer', v || null)}
        />
        <TextField
          label="Client ID"
          value={form.lti_platform_client_id ?? ''}
          onChange={(v) => field('lti_platform_client_id', v || null)}
        />
        <div>
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
            Deployment ID (по одному на строку)
          </label>
          <textarea
            className="w-full border border-border rounded-md px-3 py-2 text-sm font-sans"
            rows={2}
            value={deploymentIdsText}
            onChange={(e) => field(
              'lti_platform_deployment_ids',
              e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
            )}
          />
        </div>
        <TextField
          label="OIDC Auth Login URL платформы"
          value={form.lti_platform_auth_login_url ?? ''}
          onChange={(v) => field('lti_platform_auth_login_url', v || null)}
        />
        <TextField
          label="Token URL платформы (для оценок и списка студентов)"
          value={form.lti_platform_auth_token_url ?? ''}
          onChange={(v) => field('lti_platform_auth_token_url', v || null)}
        />
        <TextField
          label="JWKS URL платформы"
          value={form.lti_platform_jwks_url ?? ''}
          onChange={(v) => field('lti_platform_jwks_url', v || null)}
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={() => saveMut.mutate(form)} loading={saveMut.isPending}>
          Сохранить
        </Button>
        <Button variant="secondary" onClick={() => testMut.mutate()} loading={testMut.isPending}>
          Проверить соединение
        </Button>
      </div>

      {testMut.data && (
        <div className={`mt-3 text-xs font-sans px-3 py-2 rounded-md border ${
          testMut.data.ok
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {testMut.data.message}
        </div>
      )}

      {!data.complete && (
        <p className="mt-4 text-xs font-sans text-ink-tertiary">
          Заполните все поля выше и сохраните, чтобы LTI-запуски принимались.
        </p>
      )}

      <h2 className="font-display text-xl font-bold text-ink mt-10 mb-2">Сопоставление курсов</h2>
      <p className="text-xs font-sans text-ink-tertiary mb-4 max-w-prose leading-relaxed">
        Курсы создаются автоматически при первом запуске из Moodle. Сопоставление с разделом
        оргструктуры нужно только для сводной отчётности по институту — на работу преподавателя не влияет.
      </p>

      {!courseLinks?.length ? (
        <p className="text-sm font-sans text-ink-tertiary">Пока нет курсов, запущенных из Moodle.</p>
      ) : (
        <div className="space-y-1.5">
          {courseLinks.map((l) => (
            <div key={l.id} className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-sans text-ink truncate">{l.context_title ?? l.context_label ?? 'Без названия'}</div>
                <div className="text-xs font-sans text-ink-tertiary truncate">{l.course_name ?? '—'}</div>
              </div>
              <div className="text-xs font-sans flex-shrink-0">
                {l.org_unit_name
                  ? <span className="text-ink">{l.org_unit_name}</span>
                  : <span className="text-ink-tertiary">не сопоставлено</span>}
              </div>
              <button
                onClick={() => setMappingLink(l)}
                className="text-xs font-sans font-medium text-amber hover:opacity-80 transition-opacity flex-shrink-0"
              >
                {l.org_unit_id ? 'Изменить' : 'Сопоставить'}
              </button>
            </div>
          ))}
        </div>
      )}

      {mappingLink && (
        <OrgUnitPickerModal
          currentUnitId={mappingLink.org_unit_id}
          onCancel={() => setMappingLink(null)}
          onPick={(unitId) => mapMut.mutate({ id: mappingLink.id, orgUnitId: unitId })}
          busy={mapMut.isPending}
        />
      )}
    </div>
  )
}

function OrgUnitPickerModal({
  currentUnitId, onPick, onCancel, busy,
}: {
  currentUnitId: string | null
  onPick: (unitId: string | null) => void
  onCancel: () => void
  busy: boolean
}) {
  const { data: units = [] } = useQuery({ queryKey: ['org-structure'], queryFn: getOrgStructure })
  const tree = useMemo(() => buildTree(units), [units])
  const [picked, setPicked] = useState<string | null>(currentUnitId)

  function renderNode(node: TreeNode, depth: number) {
    return (
      <div key={node.id}>
        <label
          className="flex items-center gap-2 text-sm font-sans px-2 py-1 rounded-md hover:bg-surface-warm cursor-pointer"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <input
            type="radio"
            name="org-unit"
            checked={picked === node.id}
            onChange={() => setPicked(node.id)}
          />
          <span className="text-ink">{node.name}</span>
          <span className="text-[10px] text-ink-tertiary uppercase">{TYPE_LABEL[node.type_code]}</span>
        </label>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3">
          <h3 className="font-display text-lg font-bold text-ink">Выберите раздел оргструктуры</h3>
        </div>
        <div className="px-2 max-h-80 overflow-y-auto">
          {tree.map((node) => renderNode(node, 0))}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <Button onClick={() => onPick(picked)} loading={busy} className="flex-1">Сохранить</Button>
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-ink-tertiary flex-shrink-0">{label}:</span>
      <code className="text-ink break-all">{value}</code>
    </div>
  )
}

function TextField({
  label, value, placeholder, onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">{label}</label>
      <input
        type="text"
        className="w-full border border-border rounded-md px-3 py-2 text-sm font-sans"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
