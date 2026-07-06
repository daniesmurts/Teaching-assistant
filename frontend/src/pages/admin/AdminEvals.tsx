import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listEvalRuns, getEvalRun, getConfidenceConfig,
  startFlywheelRun, startConfidenceRun, applyThresholds, evalCsvUrl,
  type RunSummary,
} from '../../api/adminEvals'
import { getAdminTeachers } from '../../api/admin'
import { useAuthStore } from '../../store/authStore'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { useUIStore } from '../../store/uiStore'

const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const STATUS_CLS: Record<string, string> = {
  running: 'bg-warning-bg text-warning',
  done:    'bg-success-bg text-success',
  failed:  'bg-danger-bg text-danger',
}

export default function AdminEvals() {
  const qc = useQueryClient()
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  // Poll the list while anything is running so status flips to done live.
  const { data: runs = [] } = useQuery({
    queryKey: ['admin-evals'],
    queryFn:  listEvalRuns,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === 'running') ? 4000 : false,
  })
  const { data: config } = useQuery({ queryKey: ['admin-eval-config'], queryFn: getConfidenceConfig })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-display text-2xl font-bold text-ink">Эксперименты (eval harness)</h1>
          {!showForm && <CreateButton onClick={() => setShowForm(true)}>Новый запуск</CreateButton>}
        </div>
        <p className="text-xs font-sans text-ink-tertiary mb-5">
          Офлайн-воспроизведение оценивания: эффект RAG-маховика (flywheel) и калибровка уверенности (confidence).
        </p>

        {/* Active calibration banner */}
        <div className="bg-surface border border-border rounded-lg px-4 py-3 mb-5 text-xs font-sans">
          <span className="font-semibold text-ink-tertiary uppercase tracking-wider">Активная калибровка уверенности</span>
          {config ? (
            <span className="text-ink-secondary ml-2">
              std ≤ {config.highStdMax} → высокая · std ≥ {config.lowStdMin} → низкая
              <span className="text-ink-tertiary"> (откалибровано {config.fittedAt ? fmt(config.fittedAt) : '—'}, n={config.nHigh}/{config.nLow})</span>
            </span>
          ) : (
            <span className="text-ink-tertiary ml-2">пороги по умолчанию (std ≤ 5 → высокая · std ≥ 12 → низкая)</span>
          )}
        </div>

        {showForm && <NewRunForm onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['admin-evals'] }) }} />}

        {/* Runs list */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {runs.length === 0 ? (
            <p className="text-sm font-sans text-ink-tertiary text-center py-10">Запусков пока нет.</p>
          ) : runs.map((r, i) => (
            <div key={r.id} className={`${i < runs.length - 1 ? 'border-b border-border' : ''}`}>
              <button
                onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors"
              >
                <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm uppercase tracking-wide ${
                  r.kind === 'confidence' ? 'bg-info-bg text-info' : 'bg-amber-light text-amber'}`}>
                  {r.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans text-ink">
                    {r.teacher_email ?? '—'}
                    {r.course_name && <span className="text-ink-tertiary"> · {r.course_name}</span>}
                  </div>
                  <div className="text-xs font-sans text-ink-tertiary">
                    K=[{r.conditions.join(',')}] · {r.result_count} результатов · {fmt(r.created_at)}
                    {r.notes && <span> · {r.notes}</span>}
                  </div>
                </div>
                <span className={`text-[10px] font-sans font-medium px-2 py-0.5 rounded-sm ${STATUS_CLS[r.status]}`}>
                  {r.status === 'running' ? 'идёт…' : r.status === 'done' ? 'готово' : 'ошибка'}
                </span>
                <span className="text-ink-tertiary text-xs">{openRun === r.id ? '−' : '+'}</span>
              </button>
              {openRun === r.id && <RunDetail runId={r.id} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── New run form ──────────────────────────────────────────────────────────────

function NewRunForm({ onDone }: { onDone: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const me = useAuthStore((s) => s.teacher)
  const [kind, setKind]       = useState<'flywheel' | 'confidence'>('flywheel')
  const [teacherId, setTeacher] = useState(me?.id ?? '')
  const [k, setK]             = useState('0,3,5')
  const [variants, setVariants] = useState<string[]>(['baseline'])
  const [samples, setSamples] = useState(3)
  const [limit, setLimit]     = useState('')
  const [notes, setNotes]     = useState('')

  function toggleVariant(v: string) {
    setVariants((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  }

  const { data: teacherData } = useQuery({
    queryKey: ['admin-teachers-lite'],
    queryFn:  () => getAdminTeachers({ page: 1 }),
  })
  const teachers = teacherData?.teachers ?? []

  const mut = useMutation({
    mutationFn: () => {
      const common = { teacher_id: teacherId, limit: limit ? Number(limit) : undefined, notes: notes || undefined }
      if (kind === 'flywheel') {
        return startFlywheelRun({
          ...common,
          k: k.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 0),
          variants: variants.length ? variants : ['baseline'],
        })
      }
      return startConfidenceRun({ ...common, k: parseInt(k.split(',')[0]?.trim() || '5', 10), samples })
    },
    onSuccess: () => { addToast('Запуск начат — выполняется в фоне', 'success'); onDone() },
    onError:   () => addToast('Не удалось запустить', 'error'),
  })

  const inputClass = 'px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="bg-surface border border-border rounded-lg p-5 mb-5 space-y-3">
      <div className="flex gap-2">
        {(['flywheel', 'confidence'] as const).map((kd) => (
          <button key={kd} onClick={() => setKind(kd)}
            className={`text-xs font-sans px-3 py-1.5 rounded-md border transition-colors ${
              kind === kd ? 'border-amber text-amber bg-amber-light' : 'border-border text-ink-secondary hover:bg-surface-warm'}`}>
            {kd === 'flywheel' ? 'RAG-маховик' : 'Уверенность'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-sans text-ink-secondary mb-1">Преподаватель</label>
          <select className={`${inputClass} w-full`} value={teacherId} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">— выберите —</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.email}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-sans text-ink-secondary mb-1">
            {kind === 'flywheel' ? 'K (через запятую)' : 'K (примеров)'}
          </label>
          <input className={`${inputClass} w-full`} value={k} onChange={(e) => setK(e.target.value)} placeholder={kind === 'flywheel' ? '0,3,5' : '5'} />
        </div>
      </div>

      {kind === 'flywheel' && (
        <div>
          <label className="block text-[11px] font-sans text-ink-secondary mb-1">Варианты для сравнения</label>
          <div className="flex gap-2">
            {(['baseline', 'contrastive', 'policyMemo', 'both'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVariant(v)}
                className={`text-xs font-sans px-2.5 py-1 rounded-md border transition-colors ${
                  variants.includes(v) ? 'border-amber text-amber bg-amber-light' : 'border-border text-ink-secondary hover:bg-surface-warm'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {kind === 'confidence' && (
          <div>
            <label className="block text-[11px] font-sans text-ink-secondary mb-1">Вариантов в ансамбле</label>
            <input type="number" min={2} max={5} className={`${inputClass} w-full`} value={samples} onChange={(e) => setSamples(Number(e.target.value))} />
          </div>
        )}
        <div>
          <label className="block text-[11px] font-sans text-ink-secondary mb-1">Лимит работ (опц.)</label>
          <input className={`${inputClass} w-full`} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="все" />
        </div>
        <div className={kind === 'confidence' ? '' : 'col-span-2'}>
          <label className="block text-[11px] font-sans text-ink-secondary mb-1">Заметка (опц.)</label>
          <input className={`${inputClass} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" loading={mut.isPending} disabled={!teacherId} onClick={() => mut.mutate()}>Запустить</Button>
        <Button size="sm" variant="secondary" onClick={onDone}>Отмена</Button>
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary">
        Запуск выполняется в фоне (несколько минут) и тратит токены DeepSeek. Статус обновляется автоматически.
      </p>
    </div>
  )
}

// ─── Run detail (expanded) ──────────────────────────────────────────────────────

function RunDetail({ runId }: { runId: string }) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-eval', runId],
    queryFn:  () => getEvalRun(runId),
    refetchInterval: (q) => (q.state.data?.run.status === 'running' ? 4000 : false),
  })

  const applyMut = useMutation({
    mutationFn: () => applyThresholds(runId),
    onSuccess: (fit) => {
      addToast(`Пороги применены: std ≤ ${fit.highStdMax} / ≥ ${fit.lowStdMin}`, 'success')
      qc.invalidateQueries({ queryKey: ['admin-eval-config'] })
    },
    onError: () => addToast('Недостаточно данных для калибровки', 'error'),
  })

  if (isLoading || !data) return <div className="px-4 py-4 text-xs font-sans text-ink-tertiary">Загрузка…</div>
  const s: RunSummary = data.summary

  return (
    <div className="px-4 py-4 bg-surface-warm/40 border-t border-border">
      {s.kind === 'flywheel' ? (
        <FlywheelTable conditions={s.conditions} csvUrl={evalCsvUrl(runId)} />
      ) : (
        <ConfidencePanel summary={s} onApply={() => applyMut.mutate()} applying={applyMut.isPending} />
      )}
    </div>
  )
}

const VARIANT_LABEL: Record<string, string> = {
  baseline:    'baseline',
  contrastive: 'контраст',
  policyMemo:  'профиль',
  both:        'контраст+профиль',
}

function FlywheelTable({ conditions, csvUrl }: { conditions: Extract<RunSummary, { kind: 'flywheel' }>['conditions']; csvUrl: string }) {
  if (conditions.length === 0) return <p className="text-xs font-sans text-ink-tertiary">Нет результатов.</p>
  const hasVariants = conditions.some((c) => c.variant !== 'baseline')
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Согласие с преподавателем по K{hasVariants ? ' × варианту' : ''}</span>
        <a href={csvUrl} className="text-xs font-sans text-amber hover:underline">Скачать CSV</a>
      </div>
      <table className="w-full text-xs font-sans">
        <thead>
          <tr className="text-ink-tertiary text-left">
            <th className="py-1 pr-3">K</th>
            {hasVariants && <th className="pr-3">вариант</th>}
            <th className="pr-3">n</th><th className="pr-3">примеров</th>
            <th className="pr-3">QWK</th><th className="pr-3">MAE</th><th>Spearman</th>
          </tr>
        </thead>
        <tbody>
          {conditions.map((c) => (
            <tr key={`${c.k}:${c.variant}`} className="border-t border-border text-ink">
              <td className="py-1 pr-3 font-medium">{c.k}</td>
              {hasVariants && <td className="pr-3">{VARIANT_LABEL[c.variant] ?? c.variant}</td>}
              <td className="pr-3">{c.n}</td>
              <td className="pr-3">{c.meanExamples.toFixed(1)}</td>
              <td className="pr-3">{c.qwk ?? '—'}</td>
              <td className="pr-3">{c.mae ?? '—'}</td>
              <td>{c.rho ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] font-sans text-ink-tertiary mt-2">QWK — согласие по 5-балльной шкале; рост с K = маховик работает. Ниже MAE / выше QWK у варианта = он лучше баллайна.</p>
    </div>
  )
}

function ConfidencePanel({ summary, onApply, applying }: {
  summary: Extract<RunSummary, { kind: 'confidence' }>; onApply: () => void; applying: boolean
}) {
  if (summary.n === 0) return <p className="text-xs font-sans text-ink-tertiary">Нет результатов.</p>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          Риск-покрытие (n={summary.n})
        </span>
        <Button size="sm" loading={applying} onClick={onApply}>Применить пороги</Button>
      </div>

      <table className="w-full text-xs font-sans">
        <thead>
          <tr className="text-ink-tertiary text-left">
            <th className="py-1 pr-3">покрытие</th><th className="pr-3">n</th>
            <th className="pr-3">ср. ошибка</th><th className="pr-3">точн. оценки</th><th>std ≤</th>
          </tr>
        </thead>
        <tbody>
          {summary.riskCoverage.map((c) => (
            <tr key={c.coverage} className="border-t border-border text-ink">
              <td className="py-1 pr-3 font-medium">{Math.round(c.coverage * 100)}%</td>
              <td className="pr-3">{c.n}</td>
              <td className="pr-3">{c.meanError.toFixed(1)}</td>
              <td className="pr-3">{Math.round(c.gradeAccuracy * 100)}%</td>
              <td>{c.signalMax.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap gap-4 text-xs font-sans">
        {summary.byLabel.map((l) => (
          <span key={l.confidence} className="text-ink-secondary">
            <span className="font-medium text-ink">{l.confidence}</span>: n={l.n}, ошибка {l.meanError.toFixed(1)}, точность {Math.round(l.gradeAccuracy * 100)}%
          </span>
        ))}
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary">
        Селективность (разрыв ошибки между уверенными и спорными): <span className="font-medium text-ink">{summary.selectivity.toFixed(1)}</span> баллов.
        «Применить пороги» откалибрует уверенность для будущих оценок по этим данным.
      </p>
    </div>
  )
}
