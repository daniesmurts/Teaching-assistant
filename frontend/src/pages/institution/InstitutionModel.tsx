import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getInstitutionModel, setInstitutionModel, type LLMProviderName,
} from '../../api/institution'

/**
 * Model selection for the institution. Shows current preferred provider,
 * actual provider breakdown of recent grades (so the admin sees the impact),
 * and a switch action with a confirmation step.
 *
 * Calc grading is always routed through DeepSeek regardless of the choice —
 * that's a hard carve-out for the reasoner-only feature, named explicitly in
 * the UX.
 */
export default function InstitutionModel() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [pendingPick, setPendingPick] = useState<LLMProviderName | undefined>()

  const { data, isLoading } = useQuery({
    queryKey: ['institution-model'],
    queryFn:  getInstitutionModel,
  })

  const mut = useMutation({
    mutationFn: setInstitutionModel,
    onSuccess: (fresh) => {
      qc.setQueryData(['institution-model'], fresh)
      addToast('Модель изменена', 'success')
      setPendingPick(undefined)
    },
    onError: () => addToast('Не удалось изменить настройку', 'error'),
  })

  if (isLoading || !data) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div>
      </div>
    )
  }

  const current = data.preferred_provider
  const currentLabel = current ? labelOf(current) : 'По умолчанию (DeepSeek)'

  function pick(p: LLMProviderName) {
    if (p === current) return
    setPendingPick(p)
  }

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="max-w-3xl mx-auto px-6 py-6">
      <h1 className="font-display text-2xl font-bold text-ink mb-2">Модель для проверок</h1>
      <p className="text-xs font-sans text-ink-tertiary mb-6 max-w-prose leading-relaxed">
        Выберите, на каком провайдере будут работать новые проверки. Изменение влияет только на
        будущие проверки — прошлые оценки остаются как есть. Накопленный «учебный цикл» (критерии,
        рубрики, RAG-маховик) сохраняется при смене модели.
      </p>

      {/* Provider options */}
      <div className="space-y-3 mb-6">
        <ProviderCard
          name="deepseek"
          label="DeepSeek"
          description="Текущий по умолчанию. Лучшее качество, особенно на длинных русскоязычных работах."
          chosen={current === null || current === 'deepseek'}
          onClick={() => pick(current === 'deepseek' ? null : 'deepseek')}
        />
        <ProviderCard
          name="yandex"
          label="Yandex GPT"
          description="РФ-резидент. Без VPN. На сложных задачах может уступать DeepSeek на 5–10%."
          chosen={current === 'yandex'}
          onClick={() => pick('yandex')}
        />
      </div>

      {/* Carve-outs */}
      <div className="bg-surface-warm border border-border rounded-md p-4 mb-6 text-xs font-sans text-ink-secondary leading-relaxed">
        <div className="font-semibold text-ink mb-1">Технические уточнения</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            <strong>Расчётные задачи</strong> (физика, математика, инженерия) всегда используют
            DeepSeek-reasoner — у Yandex GPT и GigaChat нет режима пошагового рассуждения.
          </li>
          <li>
            <strong>Эмбеддинги</strong> (для RAG-маховика и поиска в библиотеке) всегда идут через
            Yandex Foundation Models, независимо от вашего выбора — это техническое ограничение
            (векторное пространство нельзя сменить без перестроения всей базы).
          </li>
          <li>
            При сбое выбранного провайдера система автоматически перезапускает запрос на DeepSeek —
            проверка не сорвётся.
          </li>
        </ul>
      </div>

      {/* Recent breakdown */}
      {data.by_provider_30d.length > 0 && (
        <div className="mb-2 text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          Проверки за 30 дней
        </div>
      )}
      <div className="space-y-1.5">
        {data.by_provider_30d.map((row) => (
          <div key={row.provider ?? 'unknown'} className="flex items-center justify-between text-xs font-sans bg-surface border border-border rounded-md px-3 py-2">
            <span className="text-ink">{row.provider ? labelOf(row.provider as 'deepseek' | 'yandex' | 'gigachat') : 'не помечено (до Phase 4)'}</span>
            <span className="text-ink-tertiary tabular-nums">{row.n}</span>
          </div>
        ))}
      </div>

      {pendingPick !== undefined && (
        <ConfirmSwitchDialog
          fromLabel={currentLabel}
          toProvider={pendingPick}
          toLabel={pendingPick ? labelOf(pendingPick) : 'По умолчанию (DeepSeek)'}
          onConfirm={() => mut.mutate(pendingPick)}
          onCancel={() => setPendingPick(undefined)}
          busy={mut.isPending}
        />
      )}
    </div>
    </div>
  )
}

function labelOf(p: 'deepseek' | 'yandex' | 'gigachat'): string {
  return p === 'deepseek' ? 'DeepSeek' : p === 'yandex' ? 'Yandex GPT' : 'GigaChat'
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function ProviderCard({
  label, description, chosen, onClick, name,
}: {
  name: string
  label: string
  description: string
  chosen: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border rounded-lg p-4 transition-colors ${
        chosen ? 'bg-amber-light/30 border-amber/40' : 'bg-surface border-border hover:border-amber/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${chosen ? 'border-amber bg-amber' : 'border-border-mid'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-sans font-semibold text-ink">{label}</div>
          <div className="text-xs font-sans text-ink-secondary leading-relaxed mt-1">{description}</div>
        </div>
        <input type="radio" name="provider" checked={chosen} readOnly className="sr-only" aria-label={name} />
      </div>
    </button>
  )
}

function ConfirmSwitchDialog({
  fromLabel, toLabel, toProvider, onConfirm, onCancel, busy,
}: {
  fromLabel:  string
  toLabel:    string
  toProvider: LLMProviderName
  onConfirm:  () => void
  onCancel:   () => void
  busy:       boolean
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5">
          <h2 className="font-display text-xl font-bold text-ink tracking-tight mb-2">
            Сменить модель?
          </h2>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed mb-3">
            С <strong>«{fromLabel}»</strong> на <strong>«{toLabel}»</strong>.
          </p>
          <p className="font-sans text-xs text-ink-secondary leading-relaxed">
            Изменение влияет на новые проверки — прошлые оценки остаются как есть. Все ваши критерии,
            рубрики и RAG-маховик продолжат работать. Расчётные задачи независимо от выбора всегда
            используют DeepSeek-reasoner.
          </p>
          {toProvider === 'yandex' && (
            <div className="mt-3 px-3 py-2 bg-amber-light/40 border border-amber/20 rounded-md text-xs font-sans text-ink-secondary leading-relaxed">
              Имейте в виду: на длинных русскоязычных работах Yandex GPT может уступать DeepSeek
              на 5–10% по совпадению с вашими оценками. Рекомендуется запустить сравнительную проверку
              до полного перехода (страница «Эксперименты»).
            </div>
          )}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <Button onClick={onConfirm} loading={busy} className="flex-1">Сменить</Button>
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        </div>
      </div>
    </div>
  )
}
