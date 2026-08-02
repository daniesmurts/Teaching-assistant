import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPricingCostInputs, getPricingInstitutions, getPricingAssumptions, updatePricingAssumptions,
  type PricingInstitution,
} from '../../api/admin'
import { useUIStore } from '../../store/uiStore'
import Button from '../../components/ui/Button'
import Icon from '../../components/ui/Icon'

// Internal platform-admin negotiation tool — modeling only. Cost/activation
// inputs come from real data (api_usage_log, institutions); tier tables and
// the two pricing models are pure client-side arithmetic on those numbers, so
// nothing here ever writes to billing/T-Bank or changes a live price.

const RETAIL_PRICE_PER_SEAT_RUB = 7_900   // current retail Teacher Pro annual price

const rub = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₽'
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

interface Tier { minSeats: number; maxSeats: number | null; discountPct: number }

const DEFAULT_TIERS: Tier[] = [
  { minSeats: 1,   maxSeats: 50,   discountPct: 0 },
  { minSeats: 51,  maxSeats: 150,  discountPct: 10 },
  { minSeats: 151, maxSeats: 300,  discountPct: 20 },
  { minSeats: 301, maxSeats: 600,  discountPct: 35 },
  { minSeats: 601, maxSeats: null, discountPct: 50 },
]

function tierForSeats(tiers: Tier[], seats: number): Tier | null {
  return tiers.find((t) => seats >= t.minSeats && (t.maxSeats === null || seats <= t.maxSeats)) ?? null
}

const field = 'px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong w-full'
const label = 'text-xs font-sans text-ink-tertiary mb-1'

export default function AdminPricing() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const [days, setDays] = useState<30 | 90>(30)
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string>('')
  const [prospectiveMode, setProspectiveMode] = useState(false)
  const [prospectiveName, setProspectiveName] = useState('')
  const [prospectiveTeachers, setProspectiveTeachers] = useState('900')
  const [manualActivation, setManualActivation] = useState('')
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS)

  // Model A: which seat count the university is actually considering buying.
  const [seatsConsidered, setSeatsConsidered] = useState('450')
  // Model B: flat site license inputs.
  const [siteSeatCap, setSiteSeatCap] = useState('450')
  const [sitePricePerSeat, setSitePricePerSeat] = useState('5900')

  const institutionIdParam = !prospectiveMode && selectedInstitutionId ? selectedInstitutionId : undefined

  const { data: costInputs, isLoading: costLoading } = useQuery({
    queryKey: ['pricing-cost-inputs', days, institutionIdParam],
    queryFn: () => getPricingCostInputs({ days, institutionId: institutionIdParam }),
  })

  const { data: institutions = [] } = useQuery({
    queryKey: ['pricing-institutions', days],
    queryFn: () => getPricingInstitutions(days),
  })

  const { data: assumptions } = useQuery({
    queryKey: ['pricing-assumptions', institutionIdParam],
    queryFn: () => getPricingAssumptions(institutionIdParam),
  })

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof updatePricingAssumptions>[1]) =>
      updatePricingAssumptions(institutionIdParam, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-assumptions', institutionIdParam] })
      addToast('Сохранено', 'success')
    },
    onError: () => addToast('Не удалось сохранить допущения', 'error'),
  })

  const selectedInstitution: PricingInstitution | undefined =
    institutions.find((i) => i.institution_id === selectedInstitutionId)

  // ─── Resolve the working numbers for this deal ───────────────────────────

  const teacherCount = prospectiveMode
    ? Math.max(0, Number(prospectiveTeachers) || 0)
    : (selectedInstitution?.teacher_count ?? 0)

  const dataActivationRate = prospectiveMode ? null : (selectedInstitution?.activation_rate ?? null)
  const overrideActivationRate = manualActivation.trim() !== ''
    ? Math.min(1, Math.max(0, Number(manualActivation) / 100))
    : (assumptions?.activationOverride != null ? assumptions.activationOverride / 100 : null)
  const activationRate = overrideActivationRate ?? dataActivationRate ?? 0

  const marginMultiplier = assumptions?.marginMultiplier ?? 3.5
  const maxDiscountPct = assumptions?.maxDiscountPct ?? 55

  const measuredCostPerTeacherRub = (costInputs?.tokenCostPerTeacherRub ?? 0) + (costInputs?.ocrCostPerTeacherRub ?? 0)
  const infraOverrideRub = assumptions?.costPerActiveTeacherManualOverrideRub
  const costPerActiveTeacherRub = measuredCostPerTeacherRub + (infraOverrideRub ?? 0)
  const minPricePerSeat = activationRate > 0 ? (costPerActiveTeacherRub * activationRate * marginMultiplier) : 0

  // ─── Model A — per-seat volume tiers ─────────────────────────────────────

  const seatsA = Math.max(0, Number(seatsConsidered) || 0)
  const tierA = tierForSeats(tiers, seatsA)
  const effectiveDiscountA = Math.min(tierA?.discountPct ?? 0, maxDiscountPct)
  const priceA = RETAIL_PRICE_PER_SEAT_RUB * (1 - effectiveDiscountA / 100)
  const revenueA = priceA * seatsA
  const activeA = seatsA * activationRate
  const costA = activeA * costPerActiveTeacherRub
  const marginA = revenueA - costA
  const marginPctA = revenueA > 0 ? marginA / revenueA : 0

  // ─── Model B — flat site license ─────────────────────────────────────────

  const seatsB = Math.max(0, Number(siteSeatCap) || 0)
  const priceB = Math.max(0, Number(sitePricePerSeat) || 0)
  const totalLicenseValueB = priceB * seatsB
  const activeB = seatsB * activationRate
  const costB = activeB * costPerActiveTeacherRub
  const marginB = totalLicenseValueB - costB
  const marginPctB = totalLicenseValueB > 0 ? marginB / totalLicenseValueB : 0

  // ─── Sensitivity grid ─────────────────────────────────────────────────────

  const sensitivitySeats = prospectiveMode ? teacherCount : (selectedInstitution?.seat_cap ?? teacherCount)
  const activationRows = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
  const priceCols = [3_000, 4_000, 5_000, 5_900, 6_900, 7_900]

  function marginPctAt(activation: number, pricePerSeat: number): number {
    const revenue = pricePerSeat * sensitivitySeats
    if (revenue <= 0) return 0
    const active = sensitivitySeats * activation
    const cost = active * costPerActiveTeacherRub
    return (revenue - cost) / revenue
  }

  function cellColor(m: number): string {
    if (m < 0.4) return 'bg-danger/15 text-danger'
    if (m < 0.6) return 'bg-amber/15 text-amber'
    return 'bg-success/15 text-success'
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  const dealName = prospectiveMode ? (prospectiveName || 'Перспективный вуз') : (selectedInstitution?.name ?? '—')

  function copySummary() {
    const lines = [
      `Организация: ${dealName}`,
      `Преподавателей: ${teacherCount}`,
      `Активация: ${pct(activationRate)}${overrideActivationRate != null ? ' (ручная оценка)' : ' (по данным)'}`,
      `Стоимость на активного преподавателя: ${rub(costPerActiveTeacherRub)}/мес`,
      '',
      `Модель A — объёмные тарифы (${seatsA} мест, скидка ${effectiveDiscountA}%)`,
      `  Цена/место: ${rub(priceA)}/год`,
      `  Выручка: ${rub(revenueA)}/год · Маржа: ${rub(marginA)} (${pct(marginPctA)})`,
      '',
      `Модель B — сайт-лицензия (${seatsB} мест по ${rub(priceB)}/год)`,
      `  Стоимость лицензии: ${rub(totalLicenseValueB)}/год`,
      `  Маржа: ${rub(marginB)} (${pct(marginPctB)})`,
    ]
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => addToast('Сводка скопирована', 'success'))
      .catch(() => addToast('Не удалось скопировать', 'error'))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-ink">Калькулятор цены</h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as 30 | 90)}
            className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
          >
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </div>

        {/* ─── Cost inputs ─── */}
        <section className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-sans text-sm font-semibold text-ink mb-3">Стоимость на активного преподавателя/мес</h2>
          {costLoading ? (
            <div className="text-xs font-sans text-ink-tertiary">Загрузка…</div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <CostCard
                title="Токены (LLM)"
                value={rub(costInputs?.tokenCostPerTeacherRub ?? 0)}
                source={`Из таблицы использования, последние ${days} дн.`}
                measured
              />
              <CostCard
                title="OCR (Yandex Vision)"
                value={rub(costInputs?.ocrCostPerTeacherRub ?? 0)}
                source={`Из таблицы использования, последние ${days} дн.`}
                measured
              />
              <CostCard
                title="Инфраструктура"
                value={infraOverrideRub != null ? rub(infraOverrideRub) : '—'}
                source="Ручная оценка — не измеряется на преподавателя"
                measured={false}
              />
            </div>
          )}
          <div className="mt-3 text-xs font-sans text-ink-tertiary">
            Курс ЦБ РФ: {costInputs ? `${costInputs.fxRate.toFixed(2)} ₽ на ${costInputs.fxRateDate}` : '—'}
            {' · '}активных преподавателей в выборке: {costInputs?.activeTeachers ?? 0}
          </div>
        </section>

        {/* ─── Assumptions ─── */}
        <section className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-sans text-sm font-semibold text-ink mb-3">Допущения</h2>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className={label}>Активация — ручной override, %</div>
              <input
                className={field} type="number" min={0} max={100}
                placeholder={dataActivationRate != null ? `по данным: ${pct(dataActivationRate)}` : 'нет данных'}
                value={manualActivation} onChange={(e) => setManualActivation(e.target.value)}
              />
            </div>
            <div>
              <div className={label}>Целевой множитель маржи</div>
              <input
                className={field} type="number" min={0} step={0.1}
                defaultValue={marginMultiplier} key={`margin-${institutionIdParam}`}
                onBlur={(e) => saveMut.mutate({ margin_multiplier: Number(e.target.value) })}
              />
            </div>
            <div>
              <div className={label}>Потолок скидки, %</div>
              <input
                className={field} type="number" min={0} max={100}
                defaultValue={maxDiscountPct} key={`discount-${institutionIdParam}`}
                onBlur={(e) => saveMut.mutate({ max_discount_pct: Number(e.target.value) })}
              />
            </div>
            <div>
              <div className={label}>Инфраструктура, ₽/преп./мес (вручную)</div>
              <input
                className={field} type="number" min={0}
                defaultValue={infraOverrideRub ?? ''} key={`infra-${institutionIdParam}`}
                placeholder="не оценено"
                onBlur={(e) => saveMut.mutate({
                  cost_per_active_teacher_manual_override_rub: e.target.value === '' ? null : Number(e.target.value),
                })}
              />
            </div>
          </div>
          <div className="mt-2 text-xs font-sans text-ink-tertiary">
            Минимальная цена/место при текущих допущениях: <span className="text-ink font-medium">{rub(minPricePerSeat)}/год</span>
            {' '}(стоимость × активация × множитель маржи)
          </div>
        </section>

        {/* ─── Institution selector ─── */}
        <section className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-sans text-sm font-semibold text-ink">Организация</h2>
            <label className="flex items-center gap-2 text-xs font-sans text-ink-secondary">
              <input type="checkbox" checked={prospectiveMode} onChange={(e) => setProspectiveMode(e.target.checked)} />
              Перспективный вуз (ещё не в системе)
            </label>
          </div>
          {prospectiveMode ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={label}>Название</div>
                <input className={field} value={prospectiveName} onChange={(e) => setProspectiveName(e.target.value)} placeholder="напр. КГУ" />
              </div>
              <div>
                <div className={label}>Преподавателей</div>
                <input className={field} type="number" min={0} value={prospectiveTeachers} onChange={(e) => setProspectiveTeachers(e.target.value)} />
              </div>
            </div>
          ) : (
            <select
              className={field}
              value={selectedInstitutionId}
              onChange={(e) => setSelectedInstitutionId(e.target.value)}
            >
              <option value="">— выберите организацию —</option>
              {institutions.map((i) => (
                <option key={i.institution_id} value={i.institution_id}>
                  {i.name} · {i.teacher_count} преп. · активация {pct(i.activation_rate)}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* ─── Model A / B ─── */}
        <div className="grid grid-cols-2 gap-4">
          <section className="bg-surface border border-border rounded-lg p-4">
            <h2 className="font-sans text-sm font-semibold text-ink mb-3">Модель A — объёмные тарифы</h2>
            <div className="mb-3">
              <div className={label}>Рассматриваемое число мест</div>
              <input className={field} type="number" min={0} value={seatsConsidered} onChange={(e) => setSeatsConsidered(e.target.value)} />
            </div>
            <table className="w-full text-xs font-sans mb-3">
              <thead><tr className="text-ink-tertiary text-left">
                <th className="py-1">Места</th><th className="py-1 text-right">Скидка %</th><th className="py-1 text-right">₽/место/год</th>
              </tr></thead>
              <tbody>
                {tiers.map((t, idx) => (
                  <tr key={idx} className={tierA === t ? 'bg-amber/10' : ''}>
                    <td className="py-1">{t.minSeats}–{t.maxSeats ?? '∞'}</td>
                    <td className="py-1 text-right">
                      <input
                        type="number" min={0} max={100} value={t.discountPct}
                        className="w-14 text-right bg-transparent border-b border-border"
                        onChange={(e) => setTiers((prev) => prev.map((p, i) => i === idx ? { ...p, discountPct: Number(e.target.value) } : p))}
                      />
                    </td>
                    <td className="py-1 text-right">{rub(RETAIL_PRICE_PER_SEAT_RUB * (1 - Math.min(t.discountPct, maxDiscountPct) / 100))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm font-sans space-y-1">
              <div className="flex justify-between"><span className="text-ink-tertiary">Выручка/год</span><span className="text-ink font-medium">{rub(revenueA)}</span></div>
              <div className="flex justify-between"><span className="text-ink-tertiary">Маржа</span><span className={marginPctA >= 0.4 ? 'text-success font-medium' : 'text-danger font-medium'}>{rub(marginA)} ({pct(marginPctA)})</span></div>
            </div>
          </section>

          <section className="bg-surface border border-border rounded-lg p-4">
            <h2 className="font-sans text-sm font-semibold text-ink mb-3">Модель B — сайт-лицензия</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className={label}>Лимит мест</div>
                <input className={field} type="number" min={0} value={siteSeatCap} onChange={(e) => setSiteSeatCap(e.target.value)} />
              </div>
              <div>
                <div className={label}>₽/место/год</div>
                <input className={field} type="number" min={0} value={sitePricePerSeat} onChange={(e) => setSitePricePerSeat(e.target.value)} />
              </div>
            </div>
            <div className="text-sm font-sans space-y-1">
              <div className="flex justify-between"><span className="text-ink-tertiary">Стоимость лицензии/год</span><span className="text-ink font-medium">{rub(totalLicenseValueB)}</span></div>
              <div className="flex justify-between"><span className="text-ink-tertiary">Ожидаемо активных преп.</span><span className="text-ink">{activeB.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-ink-tertiary">Маржа</span><span className={marginPctB >= 0.4 ? 'text-success font-medium' : 'text-danger font-medium'}>{rub(marginB)} ({pct(marginPctB)})</span></div>
            </div>
          </section>
        </div>

        {/* ─── Sensitivity ─── */}
        <section className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-sans text-sm font-semibold text-ink mb-3">
            Чувствительность маржи — {sensitivitySeats} мест ({dealName})
          </h2>
          <div className="overflow-x-auto">
            <table className="text-xs font-sans w-full">
              <thead><tr>
                <th className="text-left px-2 py-1 text-ink-tertiary">Активация ＼ Цена</th>
                {priceCols.map((p) => <th key={p} className="text-right px-2 py-1 text-ink-tertiary">{rub(p)}</th>)}
              </tr></thead>
              <tbody>
                {activationRows.map((a) => (
                  <tr key={a}>
                    <td className="px-2 py-1 text-ink-secondary">{pct(a)}</td>
                    {priceCols.map((p) => {
                      const m = marginPctAt(a, p)
                      return <td key={p} className={`px-2 py-1 text-right rounded ${cellColor(m)}`}>{pct(m)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── Export ─── */}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={copySummary}>
            <Icon name="copy" />
            Скопировать сводку
          </Button>
        </div>
      </div>
    </div>
  )
}

function CostCard({ title, value, source, measured }: { title: string; value: string; source: string; measured: boolean }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-xs font-sans text-ink-tertiary mb-1">{title}</div>
      <div className="font-display text-xl font-bold text-ink mb-1">{value}</div>
      <div className={`text-[11px] font-sans ${measured ? 'text-ink-tertiary' : 'text-amber'}`}>
        {measured ? '● ' : '○ '}{source}
      </div>
    </div>
  )
}
