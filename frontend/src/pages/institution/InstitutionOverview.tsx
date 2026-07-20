import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getInstitutionOverview, getInstitutionUsage, getDocumentDomains, setDocumentDomains } from '../../api/institution'
import { useUIStore } from '../../store/uiStore'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-3xl font-bold leading-none text-ink">{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

export default function InstitutionOverview() {
  const { data: overview } = useQuery({ queryKey: ['inst-overview'], queryFn: getInstitutionOverview })
  const { data: usage = [] } = useQuery({ queryKey: ['inst-usage', 30], queryFn: () => getInstitutionUsage(30) })

  const maxGrades = Math.max(1, ...usage.map((u) => u.grade_count))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">{overview?.institution?.name ?? 'Организация'}</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Сводка по вашей организации · показатели только в единицах (без стоимости)
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="Преподавателей"      value={overview?.totalTeachers      ?? '—'} />
          <StatCard label="Активны за месяц"     value={overview?.activeThisMonth    ?? '—'} />
          <StatCard label="Проверок всего"       value={overview?.totalGrades        ?? '—'} />
          <StatCard label="Презентаций всего"    value={overview?.totalPresentations ?? '—'} />
        </div>

        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
          Проверки за 30 дней
        </div>
        <div className="bg-surface border border-border rounded-lg p-5">
          {usage.length === 0 ? (
            <p className="text-sm font-sans text-ink-secondary text-center py-8">Пока нет активности.</p>
          ) : (
            <div className="flex gap-1 h-32">
              {usage.slice().reverse().map((u) => (
                <div key={u.date} className="flex-1 flex flex-col items-center justify-end group relative"
                     title={`${new Date(u.date).toLocaleDateString('ru-RU')} — ${u.grade_count} проверок`}>
                  <div className="w-full rounded-t-sm bg-amber/80 transition-all"
                       style={{ height: `${Math.max(4, (u.grade_count / maxGrades) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mt-8 mb-3">
          Загрузка документов по ссылке
        </div>
        <DocumentDomainsCard />
      </div>
    </div>
  )
}

// Manages the allowlist for the "paste a link instead of a file" feature on
// programme documents. The server only fetches from these domains (subdomains
// included). Empty ⇒ the feature refuses every link for this institution.
function DocumentDomainsCard() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [input, setInput] = useState('')

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['inst-document-domains'],
    queryFn:  getDocumentDomains,
  })

  const mutation = useMutation({
    mutationFn: (next: string[]) => setDocumentDomains(next),
    onSuccess:  (saved) => {
      qc.setQueryData(['inst-document-domains'], saved)
      setInput('')
    },
    onError:    () => { /* axios interceptor shows the error toast */ },
  })

  function add() {
    const value = input.trim()
    if (!value) return
    if (domains.some((d) => d.toLowerCase() === value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''))) {
      addToast('Такой домен уже есть в списке', 'info')
      return
    }
    mutation.mutate([...domains, value])
  }

  function remove(domain: string) {
    mutation.mutate(domains.filter((d) => d !== domain))
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <p className="text-sm font-sans text-ink-secondary leading-relaxed mb-4">
        Когда преподаватель вставляет ссылку на документ (РПД, практику, описание ОП, учебный план) вместо файла, сервер загружает его сам — но только с доменов из этого списка. Достаточно указать основной домен вуза (например <span className="font-medium text-ink">kstu.ru</span>) — поддомены вроде <span className="font-medium text-ink">www.kstu.ru</span> разрешаются автоматически.
      </p>

      {isLoading ? (
        <p className="text-sm font-sans text-ink-tertiary">Загрузка…</p>
      ) : domains.length === 0 ? (
        <p className="text-sm font-sans text-ink-tertiary mb-4">
          Список пуст — загрузка по ссылке пока недоступна. Добавьте домен вашего вуза, чтобы включить её.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-4">
          {domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 text-xs font-sans text-ink border border-border-mid rounded-md pl-2.5 pr-1.5 py-1">
              {d}
              <button
                type="button"
                onClick={() => remove(d)}
                disabled={mutation.isPending}
                className="text-ink-tertiary hover:text-danger transition-colors text-sm leading-none disabled:opacity-40"
                aria-label={`Убрать ${d}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="kstu.ru"
          className="flex-1 min-w-0 text-sm font-sans bg-surface border border-border rounded-md px-3 py-1.5 outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={add}
          disabled={mutation.isPending || !input.trim()}
          className="text-xs font-sans font-medium text-amber border border-amber/50 bg-amber-light/60 rounded-md px-3 py-1.5 hover:bg-amber-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Добавить
        </button>
      </div>
    </div>
  )
}
