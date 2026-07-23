import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CreateButton from '../components/ui/CreateButton'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { getCourses } from '../api/courses'
import {
  extractBrsDraft, getBrsSchemeForCourse, createBrsDraft, publishBrsScheme, addBrsManualEntry,
} from '../api/brs'
import { useUIStore } from '../store/uiStore'
import type { BrsDraft, BrsCheckpoint, BrsGradeThreshold } from '../types'

const emptyDraft: BrsDraft = { title: null, checkpoints: [], gradeThresholds: [] }
const inputCls = 'px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

/**
 * Feature AE v1 (TODO.md "### AE") — БРС (балльно-рейтинговая система)
 * engine. Extract from a course's РПД → editable review screen → confirm/
 * publish. AI never final (rule #3): nothing is persisted until the teacher
 * confirms, and every checkpoint name is verbatim-checked against the
 * source (rule #2) — the review screen flags anything that may have been
 * paraphrased instead of quoted.
 */
export default function BrsStudio() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [courseId, setCourseId] = useState('')
  const [mode, setMode] = useState<'view' | 'review'>('view')
  const [draft, setDraft] = useState<BrsDraft>(emptyDraft)
  const [extracting, setExtracting] = useState(false)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const schemeQuery = useQuery({
    queryKey: ['brs-scheme', courseId],
    queryFn: () => getBrsSchemeForCourse(courseId),
    enabled: Boolean(courseId),
  })
  const scheme = schemeQuery.data ?? null

  async function extract() {
    if (!courseId) return
    setExtracting(true)
    try {
      const extracted = await extractBrsDraft(courseId)
      setDraft(extracted)
      setMode('review')
    } catch {
      addToast('Не удалось разобрать РПД — попробуйте создать схему вручную', 'error')
      setDraft(emptyDraft)
      setMode('review')
    } finally {
      setExtracting(false)
    }
  }

  function editExisting() {
    if (!scheme) return
    setDraft(scheme)
    setMode('review')
  }

  const publishMut = useMutation({
    mutationFn: async () => {
      const id = draft.id ?? (await createBrsDraft(courseId, draft)).id!
      return publishBrsScheme(id, draft)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brs-scheme', courseId] })
      addToast('Схема БРС опубликована', 'success')
      setMode('view')
      setDraft(emptyDraft)
    },
    onError: () => addToast('Не удалось опубликовать схему — проверьте контрольные точки', 'error'),
  })

  function updateCheckpoint(i: number, patch: Partial<BrsCheckpoint>) {
    setDraft((d) => ({ ...d, checkpoints: d.checkpoints.map((c, idx) => idx === i ? { ...c, ...patch } : c) }))
  }
  function removeCheckpoint(i: number) {
    setDraft((d) => ({ ...d, checkpoints: d.checkpoints.filter((_, idx) => idx !== i) }))
  }
  function addCheckpoint() {
    setDraft((d) => ({ ...d, checkpoints: [...d.checkpoints, { name: '', max_points: 0, checkpoint_type: 'graded', is_verbatim_verified: false }] }))
  }
  function updateThreshold(i: number, patch: Partial<BrsGradeThreshold>) {
    setDraft((d) => ({ ...d, gradeThresholds: d.gradeThresholds.map((t, idx) => idx === i ? { ...t, ...patch } : t) }))
  }
  function removeThreshold(i: number) {
    setDraft((d) => ({ ...d, gradeThresholds: d.gradeThresholds.filter((_, idx) => idx !== i) }))
  }
  function addThreshold() {
    setDraft((d) => ({ ...d, gradeThresholds: [...d.gradeThresholds, { min_points: 0, max_points: 0, grade_label: '' }] }))
  }

  const canPublish = draft.checkpoints.length > 0 && draft.checkpoints.every((c) => c.name.trim() && c.max_points > 0)

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="БРС" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
          {mode === 'view' && (
            <FeatureIntro
              id="brs-studio"
              videoSlug="brs-studio"
              title="БРС — семестровый журнал по вашей РПД"
              description="Извлеките балльно-рейтинговую схему из РПД дисциплины — контрольные точки, максимальные баллы, пороги итоговой оценки. Каждая проверенная работа сможет засчитываться в нужную точку, а журнал студента покажет накопленный балл и итоговую оценку."
              steps={[
                'Выберите предмет и нажмите «Извлечь БРС из РПД».',
                'Проверьте и поправьте контрольные точки перед публикацией — ничего не сохраняется без вашего подтверждения.',
                'При проверке работ и сохранении тестов в журнал выбирайте нужную контрольную точку.',
              ]}
            />
          )}

          <div className="flex items-center justify-between gap-3 mb-4">
            <Select
              value={courseId}
              onChange={(v) => { setCourseId(v); setMode('view') }}
              ariaLabel="Предмет"
              className="w-full max-w-xs"
              options={[{ value: '', label: '— выберите предмет —' }, ...courses.map((c) => ({ value: c.id, label: c.name }))]}
            />
            {courseId && mode === 'view' && (
              <CreateButton loading={extracting} onClick={extract}>Извлечь БРС из РПД</CreateButton>
            )}
          </div>

          {mode === 'review' ? (
            <div className="space-y-6">
              <p className="text-xs font-sans text-ink-tertiary">
                Данные извлечены автоматически — проверьте и исправьте перед публикацией. Ничего не сохраняется, пока вы не нажмёте «Опубликовать».
              </p>

              <Input label="Название схемы (опционально)" value={draft.title ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="БРС по дисциплине" />

              <section className="bg-surface border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-sans text-sm font-semibold text-ink">Контрольные точки</h2>
                  <button onClick={addCheckpoint} className="text-xs text-amber hover:opacity-80">+ добавить</button>
                </div>
                {draft.checkpoints.length === 0 && (
                  <p className="text-xs font-sans text-ink-tertiary">Контрольные точки не найдены — добавьте вручную.</p>
                )}
                {draft.checkpoints.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 border-t border-border first:border-t-0">
                    <span title={c.is_verbatim_verified ? 'Дословно совпадает с текстом РПД' : 'Не найдено дословное совпадение — проверьте название'}
                      className={`flex-shrink-0 mt-2 text-xs ${c.is_verbatim_verified ? 'text-success' : 'text-warning'}`}>
                      {c.is_verbatim_verified ? '✓' : '⚠'}
                    </span>
                    <input className={inputCls + ' flex-1'} value={c.name}
                      onChange={(e) => updateCheckpoint(i, { name: e.target.value, is_verbatim_verified: false })} placeholder="КТ-1 Контрольная работа" />
                    <input className={inputCls + ' w-20 flex-shrink-0'} type="number" value={c.max_points || ''}
                      onChange={(e) => updateCheckpoint(i, { max_points: Number(e.target.value) || 0 })} placeholder="баллы" />
                    <select className={inputCls + ' w-28 flex-shrink-0'} value={c.checkpoint_type}
                      onChange={(e) => updateCheckpoint(i, { checkpoint_type: e.target.value as 'graded' | 'manual' })}>
                      <option value="graded">оценка</option>
                      <option value="manual">вручную</option>
                    </select>
                    <button onClick={() => removeCheckpoint(i)} className="flex-shrink-0 mt-1.5 text-ink-tertiary hover:text-danger">×</button>
                  </div>
                ))}
              </section>

              <section className="bg-surface border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-sans text-sm font-semibold text-ink">Пороги итоговой оценки</h2>
                  <button onClick={addThreshold} className="text-xs text-amber hover:opacity-80">+ добавить</button>
                </div>
                {draft.gradeThresholds.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-t border-border first:border-t-0">
                    <input className={inputCls + ' w-20'} type="number" value={t.min_points || ''}
                      onChange={(e) => updateThreshold(i, { min_points: Number(e.target.value) || 0 })} placeholder="от" />
                    <input className={inputCls + ' w-20'} type="number" value={t.max_points || ''}
                      onChange={(e) => updateThreshold(i, { max_points: Number(e.target.value) || 0 })} placeholder="до" />
                    <input className={inputCls + ' flex-1'} value={t.grade_label}
                      onChange={(e) => updateThreshold(i, { grade_label: e.target.value })} placeholder="удовлетворительно" />
                    <button onClick={() => removeThreshold(i)} className="flex-shrink-0 text-ink-tertiary hover:text-danger">×</button>
                  </div>
                ))}
              </section>

              <div className="flex gap-2">
                <Button loading={publishMut.isPending} disabled={!canPublish} onClick={() => publishMut.mutate()}>
                  Опубликовать
                </Button>
                <Button variant="secondary" onClick={() => { setMode('view'); setDraft(emptyDraft) }}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : scheme ? (
            <SchemeView scheme={scheme} onEdit={editExisting} />
          ) : courseId ? (
            <div className="text-center py-12">
              <p className="font-sans text-sm text-ink-secondary mb-1">Для этого предмета ещё нет схемы БРС.</p>
              <p className="font-sans text-xs text-ink-tertiary">Нажмите «Извлечь БРС из РПД» выше, чтобы начать.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SchemeView({ scheme, onEdit }: { scheme: BrsDraft; onEdit: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const [manualFor, setManualFor] = useState<string | null>(null)
  const [manualName, setManualName] = useState('')
  const [manualGroup, setManualGroup] = useState('')
  const [manualPoints, setManualPoints] = useState('')

  const manualMut = useMutation({
    mutationFn: () => addBrsManualEntry(scheme.id!, {
      checkpoint_id: manualFor!, student_name: manualName.trim(),
      student_group: manualGroup.trim() || undefined, points: Number(manualPoints) || 0,
    }),
    onSuccess: () => {
      addToast('Баллы добавлены', 'success')
      setManualFor(null); setManualName(''); setManualGroup(''); setManualPoints('')
    },
    onError: () => addToast('Не удалось добавить баллы', 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">{scheme.title || 'Схема БРС'}</h2>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${scheme.status === 'published' ? 'bg-success-bg text-success' : 'bg-surface-warm text-ink-tertiary'}`}>
            {scheme.status === 'published' ? 'Опубликована' : 'Черновик'} · версия {scheme.version}
          </span>
        </div>
        <Button variant="secondary" onClick={onEdit}>Изменить</Button>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
              <th className="text-left px-4 py-2 font-medium">Контрольная точка</th>
              <th className="text-right px-4 py-2 font-medium">Макс. баллы</th>
              <th className="text-left px-4 py-2 font-medium">Тип</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {scheme.checkpoints.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-ink">{c.name}</td>
                <td className="px-4 py-2.5 text-right text-ink-secondary">{c.max_points}</td>
                <td className="px-4 py-2.5 text-ink-tertiary">{c.checkpoint_type === 'manual' ? 'вручную' : 'оценка'}</td>
                <td className="px-4 py-2.5 text-right">
                  {c.checkpoint_type === 'manual' && (
                    <button onClick={() => setManualFor(manualFor === c.id ? null : c.id!)} className="text-xs text-amber hover:opacity-80">
                      + баллы
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manualFor && (
        <div className="bg-surface border border-border rounded-lg p-4 flex items-end gap-2">
          <label className="flex-1 block">
            <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">Студент</span>
            <input className={inputCls + ' w-full'} value={manualName} onChange={(e) => setManualName(e.target.value)} />
          </label>
          <label className="w-28 block flex-shrink-0">
            <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">Группа</span>
            <input className={inputCls + ' w-full'} value={manualGroup} onChange={(e) => setManualGroup(e.target.value)} />
          </label>
          <label className="w-20 block flex-shrink-0">
            <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">Баллы</span>
            <input className={inputCls + ' w-full'} type="number" value={manualPoints} onChange={(e) => setManualPoints(e.target.value)} />
          </label>
          <Button loading={manualMut.isPending} disabled={!manualName.trim() || !manualPoints}
            onClick={() => manualMut.mutate()}>Добавить</Button>
        </div>
      )}

      {scheme.gradeThresholds.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">Пороги итоговой оценки</div>
          <div className="flex flex-wrap gap-2">
            {scheme.gradeThresholds.map((t, i) => (
              <span key={i} className="text-xs font-sans bg-surface-warm text-ink-secondary px-2 py-1 rounded-md">
                {t.min_points}–{t.max_points}: {t.grade_label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
