import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCapacityOverview, type CapacityOverview, type InstitutionSummaryRow } from '../../api/admin'

// TODO.md Feature AL Phase 2 — operator framing by default (dense, real
// names), investor framing as a second mode (pseudonymised institutions by
// default, trend-aware messaging). Same data, two lenses — see the design
// note in TODO.md: "the human supplies the growth assumption via a
// scenario input; the page supplies headroom."

type Mode = 'operator' | 'investor'

const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtPct = (n: number) => `${n.toFixed(0)}%`

export default function AdminCapacity() {
  const [mode, setMode]           = useState<Mode>('operator')
  const [month, setMonth]         = useState<string | undefined>(undefined)
  const [scenarioInput, setScenarioInput] = useState('')
  const [showNames, setShowNames] = useState(true)   // operator default; investor mode forces this false until toggled

  const scenarioTeachers = scenarioInput.trim() !== '' && Number.isFinite(Number(scenarioInput))
    ? Math.max(0, Math.round(Number(scenarioInput)))
    : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['admin-capacity', month, scenarioTeachers],
    queryFn:  () => getCapacityOverview({ month, scenarioTeachers }),
  })

  const pseudonymise = mode === 'investor' && !showNames

  if (isLoading) {
    return <div className="flex-1 overflow-y-auto"><div className="max-w-5xl mx-auto px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div></div>
  }

  if (!data || 'noData' in data) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <h1 className="font-display text-2xl font-bold text-ink mb-4">Capacity</h1>
          <div className="bg-surface border border-border rounded-lg p-6 text-sm font-sans text-ink-secondary">
            {data?.message ?? 'Нет данных — сначала запустите npm run rollup:backfill'}
          </div>
        </div>
      </div>
    )
  }

  const tabClass = (m: Mode) =>
    `px-3 py-1.5 text-sm font-sans font-medium rounded-md whitespace-nowrap transition-colors ${
      mode === m ? 'bg-amber text-white' : 'text-ink-secondary hover:bg-surface-warm'
    }`

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Capacity</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Отслеживается с {data.trackingSinceMonth} · {data.availableMonths.length} мес. в базе
              {!data.isTrendReady && ' · пока уровень, не тренд (нужно ≥3 мес.)'}
            </p>
          </div>
          <div className="flex gap-1">
            <button className={tabClass('operator')} onClick={() => setMode('operator')}>Оператор</button>
            <button className={tabClass('investor')} onClick={() => { setMode('investor'); setShowNames(false) }}>Инвестор</button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={month ?? data.month}
            onChange={(e) => setMonth(e.target.value)}
            className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
          >
            {data.availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs font-sans text-ink-tertiary">Сценарий: активных преподавателей</label>
            <input
              type="number" min={0}
              placeholder={String(data.activeTeachers)}
              value={scenarioInput}
              onChange={(e) => setScenarioInput(e.target.value)}
              className="w-24 text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
            />
          </div>
          {mode === 'investor' && (
            <label className="flex items-center gap-1.5 text-xs font-sans text-ink-secondary cursor-pointer ml-auto">
              <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              Показывать названия организаций
            </label>
          )}
        </div>

        {mode === 'operator'
          ? <OperatorView data={data} pseudonymise={pseudonymise} />
          : <InvestorView data={data} pseudonymise={pseudonymise} />}
      </div>
    </div>
  )
}

function institutionLabel(inst: InstitutionSummaryRow, index: number, pseudonymise: boolean): string {
  return pseudonymise ? `Организация #${index + 1}` : inst.name
}

function OperatorView({ data, pseudonymise }: { data: CapacityOverview; pseudonymise: boolean }) {
  return (
    <>
      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-2">Стоимость по тарифу — {data.month}</h2>
        <div className="bg-surface border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead><tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
              <th className="text-left px-3 py-2 font-medium">Тариф</th>
              <th className="text-right px-3 py-2 font-medium">n</th>
              <th className="text-right px-3 py-2 font-medium">Среднее</th>
              <th className="text-right px-3 py-2 font-medium">p50</th>
              <th className="text-right px-3 py-2 font-medium">p95</th>
              <th className="text-right px-3 py-2 font-medium">Максимум</th>
            </tr></thead>
            <tbody>
              {data.tierDistribution.map((t) => (
                <tr key={t.tier} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-ink font-medium">{t.tier}</td>
                  <td className="px-3 py-2 text-right text-ink-secondary">{t.n}</td>
                  <td className="px-3 py-2 text-right text-ink">{fmtUsd(t.mean)}</td>
                  <td className="px-3 py-2 text-right text-ink">{fmtUsd(t.p50)}</td>
                  <td className="px-3 py-2 text-right text-ink">{fmtUsd(t.p95)}</td>
                  <td className="px-3 py-2 text-right font-medium text-ink">{fmtUsd(t.max)}</td>
                </tr>
              ))}
              {data.tierDistribution.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
        {data.freeOutliers.some((o) => o.total > 0) && (
          <p className="text-xs font-sans text-ink-tertiary mt-2">
            Free-тариф дороже порога:{' '}
            {data.freeOutliers.map((o) => `>$${o.thresholdUsd}: ${o.count} из ${o.total}`).join(' · ')}
          </p>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-2">По организациям</h2>
        <div className="bg-surface border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead><tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
              <th className="text-left px-3 py-2 font-medium">Организация</th>
              <th className="text-right px-3 py-2 font-medium">Места</th>
              <th className="text-right px-3 py-2 font-medium">Использование</th>
              <th className="text-right px-3 py-2 font-medium">Стоимость</th>
              <th className="text-right px-3 py-2 font-medium">Выручка/мес</th>
              <th className="text-right px-3 py-2 font-medium">Маржа</th>
              <th className="text-right px-3 py-2 font-medium">$/место</th>
            </tr></thead>
            <tbody>
              {data.institutions.map((inst, i) => (
                <tr key={inst.institutionId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-ink font-medium">{institutionLabel(inst, i, pseudonymise)}</td>
                  <td className="px-3 py-2 text-right text-ink">
                    {inst.activeSeats}{inst.seatsPurchased != null ? ` / ${inst.seatsPurchased}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-secondary">
                    {inst.utilizationPct != null ? fmtPct(inst.utilizationPct) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-ink">{fmtUsd(inst.costUsd)}</td>
                  <td className="px-3 py-2 text-right text-ink">{inst.revenueUsd != null ? fmtUsd(inst.revenueUsd) : '— (нет контракта)'}</td>
                  <td className={`px-3 py-2 text-right font-medium ${inst.marginUsd != null ? (inst.marginUsd >= 0 ? 'text-green-700' : 'text-red-600') : 'text-ink-tertiary'}`}>
                    {inst.marginUsd != null ? `${inst.marginUsd >= 0 ? '+' : ''}${fmtUsd(inst.marginUsd)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-secondary">{fmtUsd(inst.costPerSeatUsd)}</td>
                </tr>
              ))}
              {data.institutions.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <HeadroomSection data={data} />
      <ProviderCeilingsSection data={data} />
    </>
  )
}

function InvestorView({ data, pseudonymise }: { data: CapacityOverview; pseudonymise: boolean }) {
  const totalCost = data.tierDistribution.reduce((s, t) => s + t.mean * t.n, 0)
  const variablePerTeacher = data.variableCostPerTeacherUsd

  return (
    <>
      <section className="bg-surface border border-border rounded-lg p-5">
        <h2 className="font-display text-lg font-semibold text-ink mb-3">Экономика на активного преподавателя</h2>
        <div className="grid grid-cols-3 gap-4 text-sm font-sans">
          <div>
            <div className="text-ink-tertiary text-xs mb-1">Активных преподавателей</div>
            <div className="font-display text-xl font-bold text-ink">{data.activeTeachers}</div>
          </div>
          <div>
            <div className="text-ink-tertiary text-xs mb-1">Переменная стоимость / преп./мес</div>
            <div className="font-display text-xl font-bold text-ink">{variablePerTeacher != null ? fmtUsd(variablePerTeacher) : '—'}</div>
          </div>
          <div>
            <div className="text-ink-tertiary text-xs mb-1">Фиксированная инфраструктура / мес</div>
            <div className="font-display text-xl font-bold text-ink">
              {data.fixedCostUsd != null ? fmtUsd(data.fixedCostUsd) : '—'}
            </div>
            {data.fixedCostUsd == null && (
              <div className="text-[11px] text-ink-tertiary mt-1">MONTHLY_INFRA_COST_USD не задан</div>
            )}
          </div>
        </div>
        <p className="text-xs font-sans text-ink-tertiary mt-3">
          Фиксированная стоимость ВМ не зависит от числа пользователей — при росте она размывается на всех.
          Переменная стоимость модели растёт линейно с активностью. Итого за месяц: {fmtUsd(totalCost)}.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-2">По организациям</h2>
        <div className="space-y-2">
          {data.institutions.map((inst, i) => (
            <div key={inst.institutionId} className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between text-sm font-sans">
              <div className="font-medium text-ink">{institutionLabel(inst, i, pseudonymise)}</div>
              <div className="flex gap-6 text-ink-secondary">
                <span>{inst.activeSeats}{inst.seatsPurchased != null ? `/${inst.seatsPurchased}` : ''} мест</span>
                <span>{fmtUsd(inst.costPerSeatUsd)}/место</span>
                <span className={inst.marginUsd != null ? (inst.marginUsd >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium') : ''}>
                  {inst.marginUsd != null ? `${inst.marginUsd >= 0 ? '+' : ''}${fmtUsd(inst.marginUsd)} маржа` : 'нет контракта'}
                </span>
              </div>
            </div>
          ))}
          {data.institutions.length === 0 && <div className="text-sm font-sans text-ink-tertiary">Нет данных</div>}
        </div>
      </section>

      <HeadroomSection data={data} />
      <ProviderCeilingsSection data={data} />
    </>
  )
}

function HeadroomSection({ data }: { data: CapacityOverview }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink mb-2">
        Запас мощности — сценарий {data.headroom.scenarioTeachers} активных преподавателей
      </h2>
      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead><tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
            <th className="text-left px-3 py-2 font-medium">Ресурс</th>
            <th className="text-right px-3 py-2 font-medium">Сейчас</th>
            <th className="text-left px-3 py-2 font-medium">Порог</th>
            <th className="text-right px-3 py-2 font-medium">При сценарии</th>
            <th className="text-right px-3 py-2 font-medium">Ломается при (среднее)</th>
            <th className="text-right px-3 py-2 font-medium">С поправкой на пик</th>
          </tr></thead>
          <tbody>
            {data.headroom.resources.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-2 text-ink font-medium">
                  {r.label}
                  {r.note && <div className="text-[11px] text-ink-tertiary font-normal mt-0.5 max-w-xs">{r.note}</div>}
                </td>
                <td className="px-3 py-2 text-right text-ink">{r.current.toLocaleString('ru-RU')} {r.unit}</td>
                <td className="px-3 py-2 text-ink-secondary text-xs">{r.ceilingLabel}</td>
                <td className="px-3 py-2 text-right text-ink-secondary">
                  {r.projectedAtScenario != null ? `${Math.round(r.projectedAtScenario).toLocaleString('ru-RU')} ${r.unit}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {r.breaksAtTeachers != null
                    ? <span className={r.breaksAtTeachers <= data.activeTeachers * 3 ? 'text-red-600' : 'text-ink'}>~{r.breaksAtTeachers.toLocaleString('ru-RU')} преп.</span>
                    : <span className="text-ink-tertiary">справочно</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {r.breaksAtTeachersPeakAdjusted != null
                    ? <span className="text-red-600">~{r.breaksAtTeachersPeakAdjusted.toLocaleString('ru-RU')} преп.</span>
                    : <span className="text-ink-tertiary">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// TODO.md Feature AL Phase 3 — three provider ceilings that fail
// differently and need separating: account balance (402), rate limit
// (429), and pool depth (accounts configured vs. recently unhealthy).
function ProviderCeilingsSection({ data }: { data: CapacityOverview }) {
  const { providerCeilings } = data
  const { peakToMean, rateLimitKnee, accounts } = providerCeilings

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink mb-2">
        Провайдеры и пиковая нагрузка — за последние {providerCeilings.windowDays} дн.
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div className="bg-surface border border-border rounded-lg p-4 text-sm font-sans">
          <div className="text-ink-tertiary text-xs mb-1">Пик/среднее (почасовая нагрузка)</div>
          <div className="font-display text-xl font-bold text-ink">
            {peakToMean.ratio != null ? `${peakToMean.ratio.toFixed(1)}×` : '—'}
          </div>
          <div className="text-[11px] text-ink-tertiary mt-1">
            {peakToMean.totalCalls > 0
              ? `пиковый час: ${peakToMean.peakHourlyCalls} вызовов из ${peakToMean.totalCalls} за период`
              : 'недостаточно данных за период'}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4 text-sm font-sans">
          <div className="text-ink-tertiary text-xs mb-1">Порог 429 (эмпирический)</div>
          {rateLimitKnee.observed ? (
            <>
              <div className="font-display text-xl font-bold text-red-600">
                ~{rateLimitKnee.minHourlyVolumeWithRateLimit} выз./час
              </div>
              <div className="text-[11px] text-ink-tertiary mt-1">
                чисто до {rateLimitKnee.maxHourlyVolumeWithoutRateLimit ?? '—'} выз./час
              </div>
            </>
          ) : (
            <>
              <div className="font-display text-xl font-bold text-ink-tertiary">не достигнут</div>
              <div className="text-[11px] text-ink-tertiary mt-1">
                429 не наблюдались за период — порог пока не определить эмпирически
                {rateLimitKnee.maxHourlyVolumeWithoutRateLimit != null && ` (максимум чисто: ${rateLimitKnee.maxHourlyVolumeWithoutRateLimit} выз./час)`}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-x-auto mb-3">
        <table className="w-full text-sm font-sans">
          <thead><tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
            <th className="text-left px-3 py-2 font-medium">Аккаунт DeepSeek</th>
            <th className="text-right px-3 py-2 font-medium">Расход/день</th>
            <th className="text-right px-3 py-2 font-medium">Отказы баланса (402)</th>
            <th className="text-right px-3 py-2 font-medium">Все отказы</th>
            <th className="text-left px-3 py-2 font-medium">Последний успех</th>
            <th className="text-center px-3 py-2 font-medium">Статус</th>
          </tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.account} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-ink font-medium">{a.account}</td>
                <td className="px-3 py-2 text-right text-ink">{fmtUsd(a.burnRatePerDayUsd)}</td>
                <td className="px-3 py-2 text-right text-ink">{a.balanceFailures || '—'}</td>
                <td className="px-3 py-2 text-right text-ink-secondary">{a.failureCount || '—'}</td>
                <td className="px-3 py-2 text-ink-secondary text-xs">
                  {a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString('ru-RU') : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {a.possiblyUnhealthy
                    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">возможно нездоров</span>
                    : <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-800">ок</span>}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">
                Нет данных по аккаунтам за период (колонка account заполняется с Phase 0 — старые вызовы её не несут)
              </td></tr>
            )}
          </tbody>
        </table>
        <p className="text-[11px] text-ink-tertiary px-3 pb-3">
          «Статус» — историческая эвристика (последнее событие — отказ без последующего успеха), а не реальное
          состояние остывания аккаунта: оно живёт в памяти каждого PM2-воркера отдельно и не агрегируется централизованно.
        </p>
      </div>

      <div className="bg-surface-warm border border-border rounded-lg p-3 text-xs font-sans text-ink-secondary">
        ⚠ {providerCeilings.yandexEmbedSpofNote}
      </div>
    </section>
  )
}
