import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getSharedRag, setSharedRagEnabled, type SharedRagSummary,
} from '../../api/institution'

/**
 * Master toggle for the kafedra-wide RAG flywheel, plus a roster of every
 * course that's currently sharing. Grouped by course code (falls back to
 * lowercased name) — that's how the retrieval query matches across teachers.
 */
export default function InstitutionSharedRag() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['institution-shared-rag'],
    queryFn:  getSharedRag,
  })

  const mut = useMutation({
    mutationFn: setSharedRagEnabled,
    onSuccess: (fresh) => {
      qc.setQueryData(['institution-shared-rag'], fresh)
      addToast(
        fresh.enabled
          ? 'Общий цикл кафедры включён'
          : 'Общий цикл кафедры выключен',
        'success',
      )
      setConfirming(null)
    },
    onError: () => addToast('Не удалось изменить настройку', 'error'),
  })

  if (isLoading || !data) {
    return <div className="px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div>
  }

  return (
    <div className="px-6 py-6 max-w-3xl">
      <h1 className="font-display text-2xl font-bold text-ink mb-2">Общий цикл кафедры</h1>
      <p className="text-xs font-sans text-ink-tertiary mb-6 max-w-prose leading-relaxed">
        Когда включено, преподаватели кафедры могут поделиться своими утверждёнными проверками. ИИ
        будет опираться на оценки коллег по тому же предмету — кафедра вырабатывает общий стиль
        оценивания, который сохраняется при смене преподавателей.
      </p>

      <MasterToggle
        enabled={data.enabled}
        onClick={() => setConfirming(data.enabled ? 'disable' : 'enable')}
        busy={mut.isPending}
      />

      {data.enabled && (
        <SummaryStats data={data} />
      )}

      {data.enabled && data.courses.length > 0 ? (
        <Roster data={data} />
      ) : data.enabled ? (
        <div className="bg-surface border border-border rounded-lg p-6 text-center mt-6">
          <p className="font-sans text-sm text-ink-secondary mb-1">
            Пока никто из преподавателей не поделился своим предметом.
          </p>
          <p className="font-sans text-xs text-ink-tertiary leading-relaxed max-w-prose mx-auto">
            На странице «Предметы» у каждого появится переключатель «+ Поделиться» — кафедральная база примеров наполняется по мере того, как они его включают.
          </p>
        </div>
      ) : null}

      {confirming && (
        <ConfirmDialog
          mode={confirming}
          onConfirm={() => mut.mutate(confirming === 'enable')}
          onCancel={() => setConfirming(null)}
          busy={mut.isPending}
        />
      )}
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function MasterToggle({
  enabled, onClick, busy,
}: { enabled: boolean; onClick: () => void; busy: boolean }) {
  return (
    <div className={`border rounded-lg p-5 mb-6 ${enabled ? 'bg-success-bg border-success/20' : 'bg-surface border-border'}`}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-sans font-semibold text-ink mb-1">
            {enabled ? 'Общий цикл включён' : 'Общий цикл выключен'}
          </div>
          <div className="text-xs font-sans text-ink-secondary leading-relaxed">
            {enabled
              ? 'Утверждённые проверки преподавателей, поделившихся своими предметами, используются как примеры для ИИ при оценке работ коллег по тому же предмету.'
              : 'Преподаватели не смогут включить «поделиться» у своих предметов, пока цикл выключен на уровне кафедры.'}
          </div>
        </div>
        <Button onClick={onClick} loading={busy} variant={enabled ? 'danger' : 'primary'}>
          {enabled ? 'Выключить' : 'Включить'}
        </Button>
      </div>
    </div>
  )
}

function SummaryStats({ data }: { data: SharedRagSummary }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      <Stat label="Поделившихся предметов" value={data.shared_courses_n} />
      <Stat label="Преподавателей" value={data.participating_teachers_n} />
      <Stat label="Образцов за 30 дней" value={data.cross_uses_30d} sub="кросс-использований" />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-2xl font-bold text-ink leading-none">{value}</div>
      {sub && <div className="text-[11px] font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

function Roster({ data }: { data: SharedRagSummary }) {
  // Group by code (preferred — exact match) or lowercased name (fallback).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; courses: SharedRagSummary['courses'] }>()
    for (const c of data.courses) {
      const key = c.course_code ? `code:${c.course_code.toLowerCase()}` : `name:${c.course_name.toLowerCase()}`
      const label = c.course_code ? `${c.course_name} (${c.course_code})` : c.course_name
      const entry = map.get(key)
      if (entry) entry.courses.push(c)
      else map.set(key, { key, label, courses: [c] })
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }, [data.courses])

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key} className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-warm flex items-center justify-between">
            <div className="font-sans text-sm font-medium text-ink">{g.label}</div>
            <div className="text-[10px] font-sans text-ink-tertiary">
              {g.courses.length} {pluralPreposition(g.courses.length)}
            </div>
          </div>
          <div className="divide-y divide-border">
            {g.courses.map((c) => (
              <div key={c.course_id} className="flex items-center gap-4 px-4 py-3 text-xs font-sans">
                <div className="flex-1 min-w-0">
                  <div className="text-ink">{c.teacher_name ?? '—'}</div>
                  <div className="text-ink-tertiary text-[11px] mt-0.5">{c.approved_n} утверждённых проверок</div>
                </div>
                <div className="text-ink-secondary tabular-nums text-right">
                  {c.cross_uses_30d}{' '}
                  <span className="text-ink-tertiary">образцов за 30 дней</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function pluralPreposition(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'преподаватель'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'преподавателя'
  return 'преподавателей'
}

// ─── Confirm dialog ──────────────────────────────────────────────────────────

function ConfirmDialog({
  mode, onConfirm, onCancel, busy,
}: { mode: 'enable' | 'disable'; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const enabling = mode === 'enable'
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5">
          <h2 className="font-display text-xl font-bold text-ink tracking-tight mb-2">
            {enabling ? 'Включить общий цикл?' : 'Выключить общий цикл?'}
          </h2>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed">
            {enabling
              ? 'Преподаватели смогут поделиться своими предметами. Сам факт включения общего цикла ещё не передаёт никаких данных — каждый преподаватель должен отдельно согласиться у себя на странице «Предметы».'
              : 'Существующие настройки «поделиться» у преподавателей сохранятся, но при выключенном общем цикле кросс-использование не происходит. Историю можно посмотреть, после выключения новых обращений не будет.'}
          </p>
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <Button onClick={onConfirm} loading={busy} variant={enabling ? 'primary' : 'danger'} className="flex-1">
            {enabling ? 'Включить' : 'Выключить'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        </div>
      </div>
    </div>
  )
}
