import { useMemo, useRef, useState, DragEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import Card, { CardBody, CardHeader } from '../../components/ui/Card'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import {
  uploadRpdExport, listRpdSnapshots, getRpdOverview, getRpdMapping,
  createRpdGroup, assignRpdDepts, learnRpdMapping, updateRpdSnapshotDate, deleteRpdSnapshot,
  downloadRpdMaster, downloadRpdGroup, downloadRpdReminder, getRpdReminderText,
  type RpdOverview, type RpdSnapshot, type RpdDeptGroup, type RpdLeaderDept, type RpdReminderPreview, type RpdAllDept,
  type RpdRegressedDept,
  type RpdGroupOverview,
} from '../../api/rpdMonitor'

const ACCEPT = '.xlsx,.xls,.doc'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Same stroke/size convention as DocumentUpload.tsx's dropzone icon and
// FosStudio.tsx's DownloadIcon — kept local rather than added to the shared
// Icon.tsx set, matching how those two pages already do it.
function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
    </svg>
  )
}

/** `invert` is for metrics where less is better (долг): the displayed number always
    matches the real, signed change (e.g. debt +79 really did go up) — only the
    color polarity flips, so the sign shown is never at odds with what happened. */
function DeltaBadge({ value, suffix = '', invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value === null || value === 0) return null
  const good = invert ? value < 0 : value > 0
  return (
    <span className={`text-xs font-sans font-medium ml-1.5 ${good ? 'text-success' : 'text-danger'}`}>
      {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  )
}

// ─── Готовность status system ──────────────────────────────────────────────
// One severity axis (% готовности) drives every visual signal on a row — the
// progress pill, the долг figure, and the row's accent stripe — so «this row
// needs attention» reads as one coherent signal instead of two competing
// color languages. Thresholds mirror the traffic-light convention she used in
// her own manual Excel highlighting (Research: red/green/yellow rows).
type RpdStatus = 'danger' | 'warning' | 'success'

function pctStatus(pct: number): RpdStatus {
  if (pct < 33) return 'danger'
  if (pct < 67) return 'warning'
  return 'success'
}

// The shared `warning` token (index.css --color-warning) is a muted mustard-brown,
// used app-wide for unrelated "pending" states elsewhere (Badge.tsx etc.) — not
// something to recolor globally just for this page. The mid tier here uses its
// own scoped orange instead, so it reads as amber/orange rather than brown.
//
// #C2410C (a first attempt) was too close in hue to danger red (~17° vs ~6°) —
// indistinguishable at a glance in the bar chart. #F97316 sits at ~25° hue with
// meaningfully higher lightness/saturation, reading as a clearly separate
// "traffic-light orange" instead of a slightly-different dark red.
//
// Tailwind's class scanner reads these files as static text — it can't resolve
// `text-[${WARNING_ORANGE}]` built from a JS constant, so every arbitrary-value
// class below is written out literally (confirmed the hard way: the interpolated
// version rendered a real DOM class with no matching CSS rule at all).
const WARNING_ORANGE = '#F97316' // kept only for non-Tailwind (SVG fill) use below

const STATUS_TEXT: Record<RpdStatus, string> = {
  danger:  'text-danger',
  warning: 'text-[#F97316]',
  success: 'text-success',
}
const STATUS_BG: Record<RpdStatus, string> = {
  danger:  'bg-danger-bg',
  warning: 'bg-[#FFEDD5]',
  success: 'bg-success-bg',
}
const STATUS_BAR: Record<RpdStatus, string> = {
  danger:  'bg-danger',
  warning: 'bg-[#F97316]',
  success: 'bg-success',
}
const STATUS_BORDER: Record<RpdStatus, string> = {
  danger:  'border-l-danger',
  warning: 'border-l-[#F97316]',
  success: 'border-l-success',
}
const STATUS_HEX: Record<RpdStatus, string> = {
  danger:  'var(--color-danger)',
  warning: WARNING_ORANGE,
  success: 'var(--color-success)',
}

/** A compact readiness pill: percentage + a filled progress track, colour-coded by status. */
function ReadinessBadge({ pct }: { pct: number }) {
  const status = pctStatus(pct)
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className={`inline-flex flex-col gap-1 rounded-md px-2 py-1 min-w-[72px] ${STATUS_BG[status]}`}>
      <span className={`text-xs font-sans font-semibold ${STATUS_TEXT[status]}`}>{pct}%</span>
      <div className="h-1 rounded-full bg-black/10 overflow-hidden">
        <div className={`h-full rounded-full ${STATUS_BAR[status]}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

/** Left accent stripe on a table row, matching the readiness status — an at-a-glance
    severity scan down the whole column, echoing her manual row-highlighting. */
function statusRowClass(pct: number): string {
  return `border-l-[3px] ${STATUS_BORDER[pctStatus(pct)]}`
}

export default function RpdMonitor() {
  const { can } = usePlan()
  const addToast = useUIStore((s) => s.addToast)
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const learnInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>(undefined)
  const [learnedCodes, setLearnedCodes] = useState<string[] | null>(null)
  const [reminderPreview, setReminderPreview] = useState<RpdReminderPreview | null>(null)
  const [selectedUnmapped, setSelectedUnmapped] = useState<Set<string>>(new Set())

  const locked = !can('rpdMonitor')

  const { data: snapshots = [] } = useQuery({
    queryKey: ['rpd-snapshots'],
    queryFn: listRpdSnapshots,
    enabled: !locked,
  })
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['rpd-overview', selectedSnapshotId],
    queryFn: () => getRpdOverview(selectedSnapshotId),
    enabled: !locked,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ['rpd-mapping'],
    queryFn: getRpdMapping,
    enabled: !locked,
  })

  const uploadMutation = useMutation({
    mutationFn: uploadRpdExport,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rpd-snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['rpd-overview'] })
      setSelectedSnapshotId(result.snapshot.id)
      if (result.flags.length > 0) {
        addToast(`Загружено. Обратите внимание: ${result.flags.length} строк с расхождениями в данных АСУ`, 'info')
      } else {
        addToast('Снимок загружен', 'success')
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      addToast(msg || 'Не удалось загрузить файл', 'error')
    },
    onSettled: () => setUploading(false),
  })

  const assignMutation = useMutation({
    mutationFn: async (input: { deptCodes: string[] } & ({ groupId: string } | { newGroupName: string })) => {
      const groupId = 'groupId' in input ? input.groupId : (await createRpdGroup(input.newGroupName)).id
      await assignRpdDepts(groupId, input.deptCodes)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rpd-mapping'] })
      queryClient.invalidateQueries({ queryKey: ['rpd-overview'] })
      setSelectedUnmapped(new Set())
      addToast('Кафедры распределены', 'success')
    },
    onError: () => addToast('Не удалось распределить кафедры', 'error'),
  })

  function toggleUnmapped(code: string) {
    setSelectedUnmapped((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  function handleFile(file: File) {
    if (locked) { showUpgradeModal('FEATURE_NOT_IN_PLAN'); return }
    setUploading(true)
    uploadMutation.mutate(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleLearnFile(file: File) {
    try {
      const codes = await learnRpdMapping(file)
      setLearnedCodes(codes)
    } catch {
      addToast('Не удалось прочитать файл института', 'error')
    }
  }

  async function assignLearnedToNewGroup(name: string) {
    if (!learnedCodes) return
    await assignMutation.mutateAsync({ newGroupName: name, deptCodes: learnedCodes })
    setLearnedCodes(null)
  }

  const unmapped = overview?.ungroupedDeptCodes ?? []

  if (locked) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">Мониторинг РПД</h1>
          <p className="text-sm font-sans text-ink-tertiary mb-6">
            Загружайте выгрузку из АСУ Университет и получайте готовые отчёты по кафедрам и институтам —
            без ручного пересчёта в Excel. Доступно на тарифе «Организация».
          </p>
          <Button onClick={() => showUpgradeModal('FEATURE_NOT_IN_PLAN')}>Узнать об апгрейде</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Мониторинг РПД</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Загрузите выгрузку из АСУ Университет — получите сводку, динамику и отчёты по институтам за секунды
          </p>
        </div>

        <FeatureIntro
          id="rpd-monitor"
          title="Как это работает"
          description="Замена еженедельного ручного пересчёта в Excel."
          steps={[
            'Скачайте выгрузку «Заполнение РПД и ФОС» из АСУ Университет (.xlsx или .doc)',
            'Загрузите файл сюда — ИСПУМ разберёт и пересчитает данные за вас',
            'Один раз распределите кафедры по институтам — дальше это применяется автоматически',
            'Смотрите сводку и динамику, скачивайте отчёты по институтам и напоминания о долгах',
          ]}
        />

        {/* Upload — matches the DocumentUpload.tsx dropzone convention used across
            the app (circular amber icon, bold line + chip hint, amber-tinted idle
            state) instead of a plain gray dashed box with one line of muted text. */}
        <div
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`mb-6 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
            uploading ? 'pointer-events-none opacity-70 border-border-mid' :
            dragOver ? 'border-amber bg-amber-light cursor-pointer' : 'border-amber/40 bg-amber-light/40 hover:border-amber/70 hover:bg-amber-light/70 cursor-pointer'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
          />
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-amber border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-sans text-ink-secondary">Обработка файла…</span>
            </>
          ) : (
            <>
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-amber text-white mb-1">
                <UploadIcon />
              </span>
              <span className="text-sm font-sans font-medium text-ink">
                Перетащите выгрузку АСУ Университет сюда
              </span>
              <span className="text-xs font-sans text-ink-secondary">
                или{' '}
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber text-white font-medium">
                  выберите файл
                </span>
              </span>
              <span className="text-[11px] font-sans text-ink-tertiary mt-1">
                Формат «Заполнение РПД и ФОС» · .xlsx или .doc · до 20 МБ
              </span>
            </>
          )}
        </div>

        {/* Unmapped кафедры */}
        {unmapped.length > 0 && (
          <Card className="mb-6 border-amber/40">
            <CardHeader>
              <h2 className="font-sans font-semibold text-sm text-ink">Кафедры без института ({unmapped.length})</h2>
            </CardHeader>
            <CardBody>
              <p className="text-xs font-sans text-ink-tertiary mb-3">
                Отметьте кафедры ниже и назначьте их институту — вручную, здесь же. Дальше это будет применяться
                автоматически ко всем новым загрузкам. Либо загрузите один из ваших файлов по институтам, и мы определим
                список кафедр за вас.
              </p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {unmapped.map((code) => {
                  const selected = selectedUnmapped.has(code)
                  return (
                    <button
                      key={code}
                      onClick={() => toggleUnmapped(code)}
                      className={`text-xs font-sans rounded px-2 py-1 border transition-colors ${
                        selected ? 'bg-amber text-white border-amber' : 'bg-surface-warm border-border hover:border-border-mid'
                      }`}
                    >
                      {code}
                    </button>
                  )
                })}
              </div>

              {selectedUnmapped.size > 0 && (
                <AssignPanel
                  count={selectedUnmapped.size}
                  groups={groups}
                  busy={assignMutation.isPending}
                  onAssignExisting={(groupId) => assignMutation.mutate({ groupId, deptCodes: Array.from(selectedUnmapped) })}
                  onAssignNew={(name) => assignMutation.mutate({ newGroupName: name, deptCodes: Array.from(selectedUnmapped) })}
                />
              )}

              <div className="mt-3 pt-3 border-t border-border">
                <input
                  ref={learnInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLearnFile(f); e.target.value = '' }}
                />
                <Button variant="secondary" size="sm" onClick={() => learnInputRef.current?.click()}>
                  Загрузить файл института, чтобы определить кафедры
                </Button>
                {learnedCodes && (
                  <LearnedGroupForm codes={learnedCodes} onCancel={() => setLearnedCodes(null)} onSave={assignLearnedToNewGroup} />
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {!overview && !overviewLoading && (
          <p className="text-sm font-sans text-ink-tertiary py-8 text-center">
            Загрузите первую выгрузку АСУ Университет, чтобы увидеть сводку
          </p>
        )}

        {overview && (
          <>
            {/* Snapshot selector */}
            {snapshots.length > 1 && (
              <div className="mb-4 flex items-center gap-2">
                <label className="text-xs font-sans text-ink-tertiary">Снимок:</label>
                <select
                  value={selectedSnapshotId ?? snapshots[0]?.id}
                  onChange={(e) => setSelectedSnapshotId(e.target.value)}
                  className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>{fmtDate(s.captured_at)} ({s.row_count} строк)</option>
                  ))}
                </select>
              </div>
            )}

            <Totals overview={overview} />
            <FosTotals overview={overview} />

            <CompletionForecast overview={overview} />

            {overview.timeSeries.length > 0 && <DynamicsPanel timeSeries={overview.timeSeries} />}

            <div className="mb-6 flex flex-wrap gap-2">
              <button
                onClick={() => downloadRpdMaster(overview.snapshot.id)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-surface border border-border-mid text-ink text-sm font-sans font-medium shadow-sm hover:border-amber hover:text-amber transition-colors"
              >
                <DownloadIcon />
                Скачать сводную таблицу (.xlsx)
              </button>
            </div>

            <GroupsTable
              overview={overview}
              onDownload={(groupId) => downloadRpdGroup(groupId, overview.snapshot.id)}
              onReminder={(groupId, name) => downloadRpdReminder(groupId, overview.snapshot.id)
                .catch(() => addToast('Не удалось сформировать напоминание', 'error'))}
              onPreviewReminder={async (groupId) => {
                try {
                  setReminderPreview(await getRpdReminderText(groupId, overview.snapshot.id))
                } catch {
                  addToast('Не удалось сформировать напоминание', 'error')
                }
              }}
            />

            {overview.leaderDepts.length > 0 && <LeaderDepts overview={overview} />}

            {overview.problemDepts.length > 0 && <ProblemDepts overview={overview} />}

            {overview.regressedDepts.length > 0 && <RegressedDepts overview={overview} />}

            <AllDeptsPanel overview={overview} />

            <SnapshotHistory
              snapshots={snapshots}
              onSelect={setSelectedSnapshotId}
              onEditDate={async (id, date) => {
                await updateRpdSnapshotDate(id, date)
                queryClient.invalidateQueries({ queryKey: ['rpd-snapshots'] })
                queryClient.invalidateQueries({ queryKey: ['rpd-overview'] })
              }}
              onDelete={async (id) => {
                await deleteRpdSnapshot(id)
                queryClient.invalidateQueries({ queryKey: ['rpd-snapshots'] })
                queryClient.invalidateQueries({ queryKey: ['rpd-overview'] })
              }}
            />
          </>
        )}

        {reminderPreview && (
          <ReminderModal
            preview={reminderPreview}
            onClose={() => setReminderPreview(null)}
            onCopy={() => { navigator.clipboard.writeText(reminderPreview.text); addToast('Скопировано', 'success') }}
          />
        )}
      </div>
    </div>
  )
}

function Totals({ overview }: { overview: RpdOverview }) {
  const t = overview.totals
  const pt = overview.previousTotals
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Card><CardBody>
        <div className="text-xs font-sans text-ink-tertiary">Дисциплин по плану</div>
        <div className="text-2xl font-display font-bold text-ink">{t.planCount}</div>
      </CardBody></Card>
      <Card><CardBody>
        <div className="text-xs font-sans text-ink-tertiary">Сделано РПД</div>
        <div className="text-2xl font-display font-bold text-ink">
          {t.rpdDone} <span className="text-sm font-sans text-ink-tertiary">({t.rpdPct}%)</span>
          <DeltaBadge value={pt ? t.rpdDone - pt.rpdDone : null} />
        </div>
      </CardBody></Card>
      <Card><CardBody>
        <div className="text-xs font-sans text-ink-tertiary">На проверке</div>
        <div className="text-2xl font-display font-bold text-ink">{t.rpdReview}</div>
      </CardBody></Card>
      <Card><CardBody>
        <div className="text-xs font-sans text-ink-tertiary">Долг по РПД</div>
        <div className="text-2xl font-display font-bold text-danger">
          {t.rpdDebt}
          <DeltaBadge value={pt ? t.rpdDebt - pt.rpdDebt : null} invert />
        </div>
      </CardBody></Card>
    </div>
  )
}

/** ФОС mirrors the same three figures as РПД (Сделано / на проверке / Долг) — a
    secondary row, since Мониторинг РПД's primary metric is РПД, but the columns
    exist in her source export and shouldn't be invisible on the platform. */
function FosTotals({ overview }: { overview: RpdOverview }) {
  const t = overview.totals
  const pt = overview.previousTotals
  return (
    <div className="mb-6">
      <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">ФОС</div>
      <div className="grid grid-cols-3 gap-3">
        <Card><CardBody>
          <div className="text-xs font-sans text-ink-tertiary">Сделано ФОС</div>
          <div className="text-xl font-display font-bold text-ink">
            {t.fosDone} <span className="text-sm font-sans text-ink-tertiary">({t.fosPct}%)</span>
            <DeltaBadge value={pt ? t.fosDone - pt.fosDone : null} />
          </div>
        </CardBody></Card>
        <Card><CardBody>
          <div className="text-xs font-sans text-ink-tertiary">ФОС на проверке</div>
          <div className="text-xl font-display font-bold text-ink">{t.fosReview}</div>
        </CardBody></Card>
        <Card><CardBody>
          <div className="text-xs font-sans text-ink-tertiary">Долг по ФОС</div>
          <div className="text-xl font-display font-bold text-danger">
            {t.fosDebt}
            <DeltaBadge value={pt ? t.fosDebt - pt.fosDebt : null} invert />
          </div>
        </CardBody></Card>
      </div>
    </div>
  )
}

// ─── Прогноз завершения — projects a completion date from the долг trend between
// the two most recent snapshots (a spreadsheet can't do this: it has no memory of
// last week's numbers to compute a rate from). Honest by construction: if долг isn't
// shrinking, we say so instead of manufacturing a date. Needs ≥2 snapshots.
const MS_PER_DAY = 86_400_000

interface Forecast {
  projectedDate: Date | null // null = no positive trend to project from
  daysToZero: number | null
}

function forecastCompletion(currentDebt: number, deltaDebt: number | null, daysBetween: number, asOf: string): Forecast {
  if (deltaDebt === null || daysBetween <= 0) return { projectedDate: null, daysToZero: null }
  const shrinkPerDay = -deltaDebt / daysBetween // deltaDebt = current - previous; negative means долг shrank
  if (shrinkPerDay <= 0 || currentDebt <= 0) return { projectedDate: null, daysToZero: null }
  const daysToZero = currentDebt / shrinkPerDay
  return { projectedDate: new Date(new Date(asOf).getTime() + daysToZero * MS_PER_DAY), daysToZero }
}

function fmtForecastDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function CompletionForecast({ overview }: { overview: RpdOverview }) {
  if (!overview.previousSnapshot || !overview.previousTotals) {
    return (
      <Card className="mb-6 border-amber/30 bg-amber-light/20">
        <CardBody>
          <p className="text-sm font-sans text-ink-secondary">
            <span className="font-semibold text-ink">Прогноз завершения</span> появится после следующей загрузки —
            нужны минимум два снимка, чтобы посчитать темп закрытия долга.
          </p>
        </CardBody>
      </Card>
    )
  }

  const daysBetween = (new Date(overview.snapshot.capturedAt).getTime() - new Date(overview.previousSnapshot.capturedAt).getTime()) / MS_PER_DAY
  const overallDeltaDebt = overview.totals.rpdDebt - overview.previousTotals.rpdDebt
  const overall = forecastCompletion(overview.totals.rpdDebt, overallDeltaDebt, daysBetween, overview.snapshot.capturedAt)

  const perGroup = overview.groups
    .filter((g) => g.rpdDebt > 0)
    .map((g) => ({ group: g, forecast: forecastCompletion(g.rpdDebt, g.deltaRpdDebt, daysBetween, overview.snapshot.capturedAt) }))
  const withForecast = perGroup.filter((p) => p.forecast.projectedDate).sort((a, b) => a.forecast.daysToZero! - b.forecast.daysToZero!)
  const noProgress = perGroup.length - withForecast.length

  return (
    <Card className="mb-6 border-amber/30">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">Прогноз завершения</h2>
      </CardHeader>
      <CardBody>
        {overall.projectedDate ? (
          <p className="text-sm font-sans text-ink-secondary mb-3">
            При текущем темпе закрытия долга (за {Math.round(daysBetween)} дн.) весь план по институту будет выполнен к{' '}
            <span className="font-display font-bold text-lg text-ink">{fmtForecastDate(overall.projectedDate)}</span>
          </p>
        ) : (
          <p className="text-sm font-sans text-ink-secondary mb-3">
            Долг не сокращается с прошлого снимка — прогноз завершения посчитать нельзя, пока темп не станет положительным.
          </p>
        )}

        {withForecast.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
            {withForecast.slice(0, 6).map(({ group, forecast }) => (
              <div key={group.groupId} className="bg-surface-warm rounded-md px-3 py-2">
                <div className="text-xs font-sans font-medium text-ink">{group.groupName}</div>
                <div className="text-xs font-sans text-ink-secondary">{fmtForecastDate(forecast.projectedDate!)}</div>
              </div>
            ))}
          </div>
        )}
        {noProgress > 0 && (
          <p className="text-xs font-sans text-ink-tertiary mt-2">
            Без положительного темпа: {noProgress} {noProgress === 1 ? 'институт' : 'института/ов'} — долг не сокращается.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Динамика роста — matches her sheet's own «Всего выполнено на <дата>» /
// «Прирост» side-panel, minus the hand-typing. Snapshots are already the raw
// weekly granularity (one per upload); «по месяцам» buckets them by calendar
// month, keeping the last snapshot in each month as that month's reading.
type RpdTimeSeriesPoint = RpdOverview['timeSeries'][number]
type DynamicsGranularity = 'snapshot' | 'month'

function monthKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 7) // YYYY-MM
}

function monthLabel(iso: string): string {
  const label = new Date(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function buildMonthlySeries(series: RpdTimeSeriesPoint[]): RpdTimeSeriesPoint[] {
  const byMonth = new Map<string, RpdTimeSeriesPoint>()
  for (const s of series) byMonth.set(monthKey(s.capturedAt), s) // series is ascending — last write per month wins
  return Array.from(byMonth.values())
}

function DynamicsPanel({ timeSeries }: { timeSeries: RpdTimeSeriesPoint[] }) {
  const [granularity, setGranularity] = useState<DynamicsGranularity>('snapshot')
  const series = granularity === 'snapshot' ? timeSeries : buildMonthlySeries(timeSeries)

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-sans font-semibold text-sm text-ink">Динамика роста</h2>
          <div className="flex gap-0.5 bg-surface-warm rounded-md p-0.5">
            {(['snapshot', 'month'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`text-xs font-sans px-2.5 py-1 rounded transition-colors ${
                  granularity === g ? 'bg-surface shadow-sm text-ink font-medium' : 'text-ink-tertiary'
                }`}
              >
                {g === 'snapshot' ? 'По неделям' : 'По месяцам'}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <RpdTrendChart series={series} granularity={granularity} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">{granularity === 'snapshot' ? 'Снимок от' : 'Месяц'}</th>
              <th className="px-4 py-2">Сделано РПД</th>
              <th className="px-4 py-2">% готовности</th>
              <th className="px-4 py-2">Прирост</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, i) => {
              const prev = series[i - 1]
              const delta = prev ? s.rpdDone - prev.rpdDone : null
              const deltaPct = prev && prev.rpdDone > 0 ? Math.round((delta! / prev.rpdDone) * 1000) / 10 : null
              return (
                <tr key={s.snapshotId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-ink-secondary">
                    {granularity === 'snapshot' ? fmtDate(s.capturedAt) : monthLabel(s.capturedAt)}
                  </td>
                  <td className="px-4 py-2 font-medium text-ink">{s.rpdDone}</td>
                  <td className="px-4 py-2 text-ink-secondary">{s.rpdPct}%</td>
                  <td className="px-4 py-2">
                    {delta === null ? (
                      <span className="text-ink-tertiary">—</span>
                    ) : (
                      <span className={`font-medium ${delta >= 0 ? 'text-success' : 'text-danger'}`}>
                        {delta >= 0 ? '+' : ''}{delta}
                        {deltaPct !== null && ` (${deltaPct >= 0 ? '+' : ''}${deltaPct}%)`}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Trend line — Сделано РПД over time against a план reference line. Hand-rolled
    SVG (no chart lib), same convention as LearningLoop.tsx's TrendChart. Needs
    ≥2 points; the table above already covers the single-snapshot case. */
function RpdTrendChart({ series, granularity }: { series: RpdTimeSeriesPoint[]; granularity: DynamicsGranularity }) {
  if (series.length < 2) return null

  const W = 720, H = 220, PAD = { l: 46, r: 20, t: 16, b: 28 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const planLatest = series[series.length - 1].planCount
  const maxVal = Math.max(planLatest, ...series.map((s) => s.rpdDone)) * 1.08

  const x = (i: number) => PAD.l + (i / (series.length - 1)) * innerW
  const y = (v: number) => PAD.t + innerH - (v / maxVal) * innerH

  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s.rpdDone)}`).join(' ')
  const label = (s: RpdTimeSeriesPoint) => granularity === 'snapshot' ? fmtDate(s.capturedAt) : monthLabel(s.capturedAt)

  return (
    <div className="px-5 pt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[0, maxVal / 2, maxVal].map((tick) => (
          <g key={tick}>
            <line x1={PAD.l} y1={y(tick)} x2={W - PAD.r} y2={y(tick)} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={PAD.l - 6} y={y(tick) + 3} textAnchor="end" className="fill-ink-tertiary text-[10px] font-sans">{Math.round(tick)}</text>
          </g>
        ))}
        {/* План — reference line, not a second data series (a static target, no legend entry needed) */}
        <line x1={PAD.l} y1={y(planLatest)} x2={W - PAD.r} y2={y(planLatest)} stroke="var(--color-ink-tertiary)" strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={W - PAD.r} y={y(planLatest) - 5} textAnchor="end" className="fill-ink-tertiary text-[10px] font-sans">План: {planLatest}</text>
        <path d={path} fill="none" stroke="var(--color-amber)" strokeWidth="2" />
        {series.map((s, i) => (
          <circle key={s.snapshotId} cx={x(i)} cy={y(s.rpdDone)} r="3.5" fill="var(--color-amber)">
            <title>{`${label(s)}: ${s.rpdDone} из ${s.planCount} (${s.rpdPct}%)`}</title>
          </circle>
        ))}
        <text x={PAD.l} y={H - 6} textAnchor="start" className="fill-ink-tertiary text-[10px] font-sans">{label(series[0])}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-ink-tertiary text-[10px] font-sans">{label(series[series.length - 1])}</text>
      </svg>
      <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-tertiary pb-1">
        <span className="w-2.5 h-0.5 bg-amber inline-block rounded-full" /> Сделано РПД
        <span className="w-2.5 h-0.5 bg-ink-tertiary inline-block rounded-full ml-3" style={{ borderTop: '1.5px dashed var(--color-ink-tertiary)', height: 0 }} /> План
      </div>
    </div>
  )
}

/** Horizontal bar comparison — same row order as the table beneath it (server-sorted by
    долг desc), bar length = готовность %, coloured by the same status tiers as everywhere
    else on the page. Status colour here is reinforced by the direct % label and the
    institute name, never color-alone. */
function InstituteBarChart({ groups }: { groups: RpdGroupOverview[] }) {
  if (groups.length === 0) return null

  const rowH = 26, gap = 10, labelW = 90, valueW = 44
  const W = 720
  const barAreaW = W - labelW - valueW
  const H = groups.length * (rowH + gap)

  return (
    <div className="px-5 pt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {groups.map((g, i) => {
          const status = pctStatus(g.rpdPct)
          const barW = Math.max(2, (g.rpdPct / 100) * barAreaW)
          const cy = i * (rowH + gap)
          return (
            <g key={g.groupId}>
              <text x={labelW - 8} y={cy + rowH / 2 + 4} textAnchor="end" className="fill-ink text-xs font-sans font-medium">
                {g.groupName}
              </text>
              <rect x={labelW} y={cy} width={barAreaW} height={rowH} rx={4} fill="var(--color-border)" opacity={0.4} />
              <rect x={labelW} y={cy} width={barW} height={rowH} rx={4} fill={STATUS_HEX[status]}>
                <title>{`${g.groupName}: ${g.rpdDone} из ${g.planCount} (${g.rpdPct}%), долг ${g.rpdDebt}`}</title>
              </rect>
              <text x={labelW + barAreaW + 8} y={cy + rowH / 2 + 4} textAnchor="start" className="fill-ink-secondary text-xs font-sans font-semibold">
                {g.rpdPct}%
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-3 text-[11px] font-sans text-ink-tertiary pb-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> &lt;33%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F97316] inline-block" /> 33–66%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> ≥67%</span>
      </div>
    </div>
  )
}

function GroupsTable({ overview, onDownload, onReminder, onPreviewReminder }: {
  overview: RpdOverview
  onDownload: (groupId: string) => void
  onReminder: (groupId: string, name: string) => void
  onPreviewReminder: (groupId: string, name: string) => void
}) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">По институтам</h2>
      </CardHeader>
      <InstituteBarChart groups={overview.groups} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">Институт</th>
              <th className="px-4 py-2">План</th>
              <th className="px-4 py-2">Сделано РПД</th>
              <th className="px-4 py-2">Готовность</th>
              <th className="px-4 py-2">Долг</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {overview.groups.map((g) => {
              const status = pctStatus(g.rpdPct)
              return (
                <tr key={g.groupId} className={`border-b border-border last:border-0 ${statusRowClass(g.rpdPct)}`}>
                  <td className="px-4 py-2 font-medium text-ink">{g.groupName}</td>
                  <td className="px-4 py-2 text-ink-secondary">{g.planCount}</td>
                  <td className="px-4 py-2 text-ink-secondary">
                    {g.rpdDone}
                    <DeltaBadge value={g.deltaRpdDone} />
                  </td>
                  <td className="px-4 py-2"><ReadinessBadge pct={g.rpdPct} /></td>
                  <td className={`px-4 py-2 font-semibold ${g.rpdDebt > 0 ? STATUS_TEXT[status] : 'text-ink-tertiary'}`}>{g.rpdDebt}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => onDownload(g.groupId)} className="text-xs font-sans text-amber-mid hover:underline mr-3">Отчёт</button>
                    <button onClick={() => onPreviewReminder(g.groupId, g.groupName)} className="text-xs font-sans text-amber-mid hover:underline mr-3">Напоминание</button>
                    <button onClick={() => onReminder(g.groupId, g.groupName)} className="text-xs font-sans text-amber-mid hover:underline">.docx</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function LeaderDepts({ overview }: { overview: RpdOverview }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">Кафедры-лидеры</h2>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">Кафедра</th>
              <th className="px-4 py-2">Институт</th>
              <th className="px-4 py-2">Форма / уровень</th>
              <th className="px-4 py-2">Готовность</th>
              <th className="px-4 py-2">Сделано / план</th>
            </tr>
          </thead>
          <tbody>
            {overview.leaderDepts.slice(0, 20).map((d: RpdLeaderDept, i) => (
              <tr key={i} className={`border-b border-border last:border-0 ${statusRowClass(d.rpdPct)}`}>
                <td className="px-4 py-2 font-medium text-ink">{d.deptCode}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.groupName ?? '—'}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.eduForm}, {d.eduLevel}</td>
                <td className="px-4 py-2"><ReadinessBadge pct={d.rpdPct} /></td>
                <td className="px-4 py-2">
                  <span className="text-ink-secondary">{d.rpdDone} / {d.planCount}</span>
                  {d.improved && (
                    <span className="text-xs font-sans font-medium bg-success-bg text-success rounded px-1.5 py-0.5 ml-2">
                      прогресс
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// Explains cases where Сделано and Долг both rose in the same period: they're not
// each other's mirror, на проверке is — this shows exactly which кафедры lost
// ground there (rejected/returned faster than они could be approved).
function RegressedDepts({ overview }: { overview: RpdOverview }) {
  return (
    <Card className="mb-6 border-danger/30">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">Долг вырос с прошлого снимка</h2>
        <p className="text-xs font-sans text-ink-tertiary mt-0.5">
          Обычно потому, что «на проверке» уменьшилось быстрее, чем выросло «сделано» — часть работ вернули или отклонили.
        </p>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">Кафедра</th>
              <th className="px-4 py-2">Институт</th>
              <th className="px-4 py-2">Форма / уровень</th>
              <th className="px-4 py-2">Долг было → стало</th>
              <th className="px-4 py-2">Δ долг</th>
              <th className="px-4 py-2">Δ на проверке</th>
            </tr>
          </thead>
          <tbody>
            {overview.regressedDepts.slice(0, 20).map((d: RpdRegressedDept, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium text-ink">{d.deptCode}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.groupName ?? '—'}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.eduForm}, {d.eduLevel}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.previousDebt} → {d.currentDebt}</td>
                <td className="px-4 py-2 font-semibold text-danger">+{d.deltaDebt}</td>
                <td className="px-4 py-2 text-ink-secondary">{d.deltaReview > 0 ? '+' : ''}{d.deltaReview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ProblemDepts({ overview }: { overview: RpdOverview }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">Проблемные кафедры</h2>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">Кафедра</th>
              <th className="px-4 py-2">Институт</th>
              <th className="px-4 py-2">Форма / уровень</th>
              <th className="px-4 py-2">Готовность</th>
              <th className="px-4 py-2">Долг</th>
            </tr>
          </thead>
          <tbody>
            {overview.problemDepts.slice(0, 20).map((d, i) => {
              const status = pctStatus(d.rpdPct)
              return (
                <tr key={i} className={`border-b border-border last:border-0 ${statusRowClass(d.rpdPct)}`}>
                  <td className="px-4 py-2 font-medium text-ink">{d.deptCode}</td>
                  <td className="px-4 py-2 text-ink-secondary">{d.groupName ?? '—'}</td>
                  <td className="px-4 py-2 text-ink-secondary">{d.eduForm}, {d.eduLevel}</td>
                  <td className="px-4 py-2"><ReadinessBadge pct={d.rpdPct} /></td>
                  <td className="px-4 py-2">
                    <span className={`font-semibold ${STATUS_TEXT[status]}`}>{d.rpdDebt}</span>
                    {d.stalled && (
                      <span className="text-xs font-sans font-medium bg-[#FFEDD5] text-[#F97316] rounded px-1.5 py-0.5 ml-2">
                        без изменений
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Все кафедры — the complete, uncapped list. «Проблемные» / «Кафедры-лидеры»
// above are curated top-N views for a quick glance; this is the whole snapshot,
// searchable, so no individual кафедра is ever invisible on the platform.
function AllDeptsPanel({ overview }: { overview: RpdOverview }) {
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return overview.allDepts.filter((d: RpdAllDept) => {
      if (groupFilter && d.groupName !== groupFilter) return false
      if (!q) return true
      return d.deptCode.toLowerCase().includes(q) || (d.groupName ?? '').toLowerCase().includes(q)
    })
  }, [overview.allDepts, query, groupFilter])

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-sans font-semibold text-sm text-ink">
            Все кафедры <span className="text-ink-tertiary font-normal">({filtered.length} из {overview.allDepts.length})</span>
          </h2>
          <div className="flex gap-2">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="text-xs font-sans bg-surface border border-border rounded-md px-2 py-1.5"
            >
              <option value="">Все институты</option>
              {overview.groups.map((g) => <option key={g.groupId} value={g.groupName}>{g.groupName}</option>)}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по кафедре…"
              className="text-xs font-sans bg-surface border border-border rounded-md px-2 py-1.5 w-40"
            />
          </div>
        </div>
      </CardHeader>
      <div className="overflow-auto max-h-[520px]">
        <table className="w-full text-sm font-sans">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="text-left text-xs text-ink-tertiary border-b border-border">
              <th className="px-4 py-2">Кафедра</th>
              <th className="px-4 py-2">Институт</th>
              <th className="px-4 py-2">Форма / уровень</th>
              <th className="px-4 py-2">Сделано / план</th>
              <th className="px-4 py-2">Готовность</th>
              <th className="px-4 py-2">Долг РПД</th>
              <th className="px-4 py-2 border-l border-border">Сделано ФОС</th>
              <th className="px-4 py-2">ФОС на проверке</th>
              <th className="px-4 py-2">Долг ФОС</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => {
              const status = pctStatus(d.rpdPct)
              const fosStatus = pctStatus(d.fosPct)
              return (
                <tr key={i} className={`border-b border-border last:border-0 ${statusRowClass(d.rpdPct)}`}>
                  <td className="px-4 py-1.5 font-medium text-ink whitespace-nowrap">{d.deptCode}</td>
                  <td className="px-4 py-1.5 text-ink-secondary whitespace-nowrap">{d.groupName ?? '—'}</td>
                  <td className="px-4 py-1.5 text-ink-secondary whitespace-nowrap">{d.eduForm}, {d.eduLevel}</td>
                  <td className="px-4 py-1.5 text-ink-secondary whitespace-nowrap">
                    {d.rpdDone} / {d.planCount}
                    <DeltaBadge value={d.deltaRpdDone} />
                  </td>
                  <td className="px-4 py-1.5"><ReadinessBadge pct={d.rpdPct} /></td>
                  <td className={`px-4 py-1.5 font-semibold ${d.rpdDebt > 0 ? STATUS_TEXT[status] : 'text-ink-tertiary'}`}>{d.rpdDebt}</td>
                  <td className="px-4 py-1.5 text-ink-secondary whitespace-nowrap border-l border-border">{d.fosDone} / {d.planCount}</td>
                  <td className="px-4 py-1.5 text-ink-secondary whitespace-nowrap">{d.fosReview}</td>
                  <td className={`px-4 py-1.5 font-semibold ${d.fosDebt > 0 ? STATUS_TEXT[fosStatus] : 'text-ink-tertiary'}`}>{d.fosDebt}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-ink-tertiary">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SnapshotHistory({ snapshots, onSelect, onEditDate, onDelete }: {
  snapshots: RpdSnapshot[]
  onSelect: (id: string) => void
  onEditDate: (id: string, date: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="font-sans font-semibold text-sm text-ink">История снимков</h2>
      </CardHeader>
      <div className="divide-y divide-border">
        {snapshots.map((s) => (
          <div key={s.id} className="px-4 py-2.5 flex items-center justify-between text-sm font-sans">
            <button onClick={() => onSelect(s.id)} className="text-ink hover:text-amber-mid text-left">
              {fmtDate(s.captured_at)} <span className="text-xs text-ink-tertiary">({s.row_count} строк, {s.source_filename})</span>
            </button>
            <div className="flex items-center gap-3">
              <input
                type="date"
                defaultValue={s.captured_at.slice(0, 10)}
                onBlur={(e) => { if (e.target.value) onEditDate(s.id, e.target.value) }}
                className="text-xs font-sans bg-surface border border-border rounded px-1.5 py-1"
              />
              <button
                onClick={() => { if (confirm('Удалить этот снимок?')) onDelete(s.id) }}
                className="text-xs font-sans text-danger hover:underline"
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function AssignPanel({ count, groups, busy, onAssignExisting, onAssignNew }: {
  count: number
  groups: RpdDeptGroup[]
  busy: boolean
  onAssignExisting: (groupId: string) => void
  onAssignNew: (name: string) => void
}) {
  const [existingGroupId, setExistingGroupId] = useState('')
  const [newName, setNewName] = useState('')

  return (
    <div className="p-3 bg-surface-warm rounded-md mb-3">
      <p className="text-xs font-sans text-ink-tertiary mb-2">Выбрано кафедр: {count}</p>
      <div className="flex flex-wrap items-center gap-2">
        {groups.length > 0 && (
          <>
            <select
              value={existingGroupId}
              onChange={(e) => setExistingGroupId(e.target.value)}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
            >
              <option value="">В существующий институт…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Button size="sm" disabled={!existingGroupId || busy} onClick={() => onAssignExisting(existingGroupId)}>
              Назначить
            </Button>
            <span className="text-xs font-sans text-ink-tertiary">или создать новый:</span>
          </>
        )}
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Название нового института"
          className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-1.5"
        />
        <Button size="sm" variant="secondary" disabled={!newName.trim() || busy} onClick={() => { onAssignNew(newName.trim()); setNewName('') }}>
          Создать и назначить
        </Button>
      </div>
    </div>
  )
}

function LearnedGroupForm({ codes, onCancel, onSave }: { codes: string[]; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="mt-3 p-3 bg-surface-warm rounded-md">
      <p className="text-xs font-sans text-ink-tertiary mb-2">Найдено {codes.length} кафедр: {codes.join(', ')}</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название института (например, ИНХН)"
          className="flex-1 text-sm font-sans bg-surface border border-border rounded-md px-3 py-1.5"
        />
        <Button size="sm" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Создать группу</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  )
}

function ReminderModal({ preview, onClose, onCopy }: { preview: RpdReminderPreview; onClose: () => void; onCopy: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-sans font-semibold text-sm text-ink">Напоминание — {preview.groupName}</h3>
            <p className="text-xs font-sans text-ink-tertiary">По данным на {preview.dateStr}</p>
          </div>
          <button onClick={onClose} className="text-ink-tertiary hover:text-ink text-sm">✕</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <p className="text-sm font-sans text-ink-secondary leading-relaxed mb-4">{preview.narrative}</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-xs text-ink-tertiary border-b border-border bg-surface-warm">
                  <th className="px-3 py-2">Кафедра</th>
                  <th className="px-3 py-2">Форма / уровень</th>
                  <th className="px-3 py-2">Сделано / план</th>
                  <th className="px-3 py-2">Готовность</th>
                  <th className="px-3 py-2">Долг</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => {
                  const status = pctStatus(r.rpdPct)
                  return (
                    <tr key={i} className={`border-b border-border last:border-0 ${statusRowClass(r.rpdPct)}`}>
                      <td className="px-3 py-1.5 font-medium text-ink whitespace-nowrap">{r.deptCode}</td>
                      <td className="px-3 py-1.5 text-ink-secondary whitespace-nowrap">{r.eduForm}, {r.eduLevel}</td>
                      <td className="px-3 py-1.5 text-ink-secondary whitespace-nowrap">{r.rpdDone} / {r.planCount}</td>
                      <td className="px-3 py-1.5"><ReadinessBadge pct={r.rpdPct} /></td>
                      <td className={`px-3 py-1.5 font-semibold ${STATUS_TEXT[status]}`}>{r.rpdDebt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Закрыть</Button>
          <Button size="sm" onClick={onCopy}>Скопировать текст</Button>
        </div>
      </div>
    </div>
  )
}
