import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CreateButton from '../components/ui/CreateButton'
import Icon from '../components/ui/Icon'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import TemplatePicker from '../components/ui/TemplatePicker'
import { getCourses } from '../api/courses'
import {
  getCriteria, getCriteriaTemplates, getCriteriaShareTargets, createCriterion, updateCriterion, deleteCriterion,
  shareCriterion, unshareCriterion,
  improveCriterionDescription,
  type CriterionPayload,
} from '../api/criteria'
import { useUIStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import { GRADES, gradeColor } from '../lib/grades'
import type { Criterion, CriterionSubject, CriterionLevelDescriptors, GradeLetter } from '../types'

const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

const UNIT_TYPE_LABEL: Record<string, string> = {
  institution: 'весь университет', department: 'кафедра', division: 'факультет',
  cluster: 'полигруппа', ugsn: 'УГСН', program_direction: 'направление', program: 'программа',
  admin_office: 'подразделение', governance: 'руководство',
}

const SUBJECTS: CriterionSubject[] = [
  'general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities',
]

interface FormState {
  id?:          string
  name:         string
  description:  string
  course_id:    string
  subject:      CriterionSubject | ''
  /** Per-level anchors, keyed by grade letter. Empty string = not set. */
  levels:       Record<GradeLetter, string>
}
const emptyLevels: Record<GradeLetter, string> = { '5': '', '4': '', '3': '', '2': '' }

const LEVEL_PLACEHOLDER: Record<GradeLetter, string> = {
  '5': 'Например: тезис сформулирован явно, каждый довод опирается на источник, есть разбор контраргумента',
  '4': 'Например: тезис ясен, доводы в основном обоснованы, но есть 1–2 утверждения без опоры',
  '3': 'Например: тезис угадывается, доводы описательные, источники почти не привлекаются',
  '2': 'Например: тезис отсутствует или противоречив, доводов нет',
}
const emptyForm: FormState = { name: '', description: '', course_id: '', subject: '', levels: { ...emptyLevels } }

/** Form levels → API shape. Blank entries are omitted; all-blank becomes null. */
function levelsToPayload(levels: Record<GradeLetter, string>): CriterionLevelDescriptors | null {
  const out: CriterionLevelDescriptors = {}
  for (const g of GRADES) {
    const v = levels[g]?.trim()
    if (v) out[g] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

export default function Criteria() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const teacherId = useAuthStore((s) => s.teacher?.id)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [showLevels, setShowLevels] = useState(false)

  const { data: criteria = [] }  = useQuery({ queryKey: ['criteria-all'], queryFn: () => getCriteria() })
  const { data: courses = [] }   = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: templates = [] } = useQuery({ queryKey: ['criteria-templates'], queryFn: getCriteriaTemplates })
  const { data: shareTargets = [] } = useQuery({ queryKey: ['criteria-share-targets'], queryFn: getCriteriaShareTargets })

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name
  const filledLevelCount = GRADES.filter((g) => !!form.levels[g]?.trim()).length

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const payload: CriterionPayload = {
        name:        f.name,
        description: f.description || null,
        level_descriptors: levelsToPayload(f.levels),
        course_id:   f.course_id || undefined,
        subject:     f.subject || undefined,
      }
      return f.id ? updateCriterion(f.id, payload) : createCriterion(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      qc.invalidateQueries({ queryKey: ['criteria'] })
      addToast('Критерий сохранён', 'success')
      close()
    },
    onError: () => addToast('Не удалось сохранить критерий', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCriterion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      qc.invalidateQueries({ queryKey: ['criteria'] })
    },
    onError:   () => addToast('Не удалось удалить критерий', 'error'),
  })

  const shareMut = useMutation({
    mutationFn: (vars: { id: string; unitId: string }) => shareCriterion(vars.id, vars.unitId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      addToast('Критерий открыт для доступа', 'success')
    },
    onError: () => addToast('Не удалось поделиться критерием', 'error'),
  })

  const unshareMut = useMutation({
    mutationFn: unshareCriterion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      addToast('Доступ к критерию закрыт', 'success')
    },
    onError: () => addToast('Не удалось закрыть доступ', 'error'),
  })

  const improveMut = useMutation({
    mutationFn: () => improveCriterionDescription(form.name, form.description),
    onSuccess: (improved) => setSuggestion(improved),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { code?: string; error?: string } } }).response?.data
      if (data?.code === 'PLAN_LIMIT_REACHED') {
        showUpgradeModal('PLAN_LIMIT_REACHED')
        return
      }
      addToast(data?.error ?? 'Не удалось улучшить описание', 'error')
    },
  })

  function close() { setShowForm(false); setForm(emptyForm); setSuggestion(null); setShowLevels(false) }

  function openNew() { setForm(emptyForm); setSuggestion(null); setShowLevels(false); setShowForm(true) }
  function openEdit(c: Criterion) {
    const levels = { ...emptyLevels, ...(c.level_descriptors ?? {}) }
    setForm({
      id: c.id, name: c.name,
      description: c.description ?? '',
      course_id: c.course_id ?? '',
      subject: c.subject ?? '',
      levels,
    })
    setSuggestion(null)
    // Auto-expand when the criterion already has anchors, so editing doesn't
    // hide them behind a collapsed section.
    setShowLevels(GRADES.some((g) => !!levels[g]))
    setShowForm(true)
  }
  function fromTemplate(t: Criterion) {
    const levels = { ...emptyLevels, ...(t.level_descriptors ?? {}) }
    setForm({
      name: t.name,
      description: t.description ?? '',
      course_id: '',
      subject: t.subject ?? '',
      levels,
    })
    setSuggestion(null)
    setShowLevels(GRADES.some((g) => !!levels[g]))
    setShowForm(true)
  }

  function requestImprove() {
    if (!form.name.trim()) { addToast('Сначала укажите название критерия', 'error'); return }
    if (!form.description.trim()) { addToast('Сначала введите описание критерия', 'error'); return }
    setSuggestion(null)
    improveMut.mutate()
  }
  function acceptSuggestion() {
    if (!suggestion) return
    setForm((f) => ({ ...f, description: suggestion }))
    setSuggestion(null)
  }
  function rejectSuggestion() { setSuggestion(null) }

  function submit() {
    if (!form.name.trim()) { addToast('Введите название критерия', 'error'); return }
    saveMut.mutate(form)
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Критерии оценки"
        actions={!showForm && <CreateButton onClick={openNew}>Новый критерий</CreateButton>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">

          {!showForm && (
            <FeatureIntro
              id="criteria"
              videoSlug="criteria"
              title="Критерии оценки — отдельные правила, которые ИСПУМ применяет к работе"
              description="Создайте библиотеку критериев — отдельных правил оценки (например «Аргументация», «Структура», «Правильность ответа»). При проверке работы выбирайте один или несколько критериев и задавайте их веса в процентах — в сумме они должны давать 100%. Без выбранных критериев проверка идёт по общим академическим стандартам."
              steps={[
                'Создайте критерий с нуля или начните с готового шаблона по вашей дисциплине.',
                'Добавьте краткое описание того, что считается хорошим ответом по этому критерию.',
                'При проверке работы выберите один или несколько критериев и задайте веса.',
                'Один и тот же критерий можно переиспользовать для любых заданий и предметов.',
              ]}
            />
          )}

          {showForm ? (
            <div className="max-w-2xl bg-surface border border-border rounded-lg p-5 space-y-4">
              <h2 className="font-display text-lg font-bold text-ink">
                {form.id ? 'Редактировать критерий' : 'Новый критерий'}
              </h2>

              <Input label="Название" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Напр. Аргументация" />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-sans font-medium text-ink-secondary">Описание</label>
                  <button
                    type="button"
                    onClick={requestImprove}
                    disabled={improveMut.isPending}
                    className="inline-flex items-center gap-1 text-xs font-sans text-amber hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon name="sparkle" size={12} />
                    {improveMut.isPending ? 'Улучшаем…' : 'Улучшить'}
                  </button>
                </div>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="Что именно оценивается — попадает в подсказку для проверки"
                  value={form.description}
                  onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); setSuggestion(null) }}
                />
                {suggestion && (
                  <div className="mt-2 p-3 bg-amber-light/40 border border-amber/30 rounded-md">
                    <div className="text-[10px] font-sans font-medium text-amber uppercase tracking-wide mb-1">Предложенная формулировка</div>
                    <p className="text-xs font-sans text-ink leading-relaxed mb-2">{suggestion}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={acceptSuggestion}>Принять</Button>
                      <Button size="sm" variant="secondary" onClick={rejectSuggestion}>Отклонить</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-level anchors. Collapsed by default: optional, and the
                  form is already dense. Filling even two of the four
                  materially sharpens both the score and the feedback, since
                  otherwise the model infers the levels from the name alone. */}
              <div className="border border-line rounded-md">
                <button
                  type="button"
                  onClick={() => setShowLevels((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left"
                >
                  <span className="text-xs font-sans font-medium text-ink-secondary">
                    Уровни оценки
                    <span className="text-ink-tertiary font-normal"> — необязательно</span>
                    {filledLevelCount > 0 && (
                      <span className="ml-2 text-[10px] font-sans text-amber">{filledLevelCount} из 4</span>
                    )}
                  </span>
                  <span className={showLevels ? 'rotate-180 transition-transform' : 'transition-transform'}>
                    <Icon name="chevron-down" size={14} />
                  </span>
                </button>
                {showLevels && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed">
                      Опишите, что по этому критерию соответствует каждой оценке. ИСПУМ будет
                      определять балл по этим уровням, а не по общему впечатлению, и укажет
                      студенту, чего не хватает до следующего уровня. Можно заполнить не все.
                    </p>
                    {GRADES.map((g) => (
                      <div key={g} className="flex gap-2 items-start">
                        <span
                          className="shrink-0 w-6 h-6 mt-1 rounded flex items-center justify-center text-xs font-sans font-semibold"
                          style={{ background: `${gradeColor(g)}1a`, color: gradeColor(g) }}
                        >
                          {g}
                        </span>
                        <textarea
                          className={`${inputClass} resize-none`}
                          rows={2}
                          placeholder={LEVEL_PLACEHOLDER[g]}
                          value={form.levels[g]}
                          onChange={(e) => setForm((f) => ({ ...f, levels: { ...f.levels, [g]: e.target.value } }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Предмет</label>
                  <select className={inputClass + ' py-2'} value={form.course_id}
                    onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}>
                    <option value="">Все предметы</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Область</label>
                  <select className={inputClass + ' py-2'} value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value as CriterionSubject | '' }))}>
                    <option value="">—</option>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={saveMut.isPending} onClick={submit}>Сохранить</Button>
                <Button size="sm" variant="secondary" onClick={close}>Отмена</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Templates — search + subject filter when the list grows */}
              <TemplatePicker
                items={templates}
                subjectLabel={SUBJECT_LABEL}
                onPick={(t) => fromTemplate(t as Criterion)}
              />

              {/* Existing criteria */}
              {criteria.length === 0 ? (
                <div className="text-center py-12">
                  <p className="font-sans text-sm text-ink-secondary mb-1">У вас пока нет критериев.</p>
                  <p className="font-sans text-xs text-ink-tertiary">
                    Создайте критерий, чтобы выбирать его при проверке работ и задавать вес в процентах.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {criteria.map((c) => {
                    const isOwn = c.teacher_id === teacherId
                    const sharedTarget = c.shared_unit_id ? shareTargets.find((t) => t.id === c.shared_unit_id) : undefined
                    return (
                    <div key={c.id} className="bg-surface border border-border rounded-lg p-4 flex flex-col">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-sans text-sm font-medium text-ink">{c.name}</span>
                          {c.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{SUBJECT_LABEL[c.subject] ?? c.subject}</span>}
                          {c.course_id && <span className="text-[10px] bg-surface-warm text-ink-secondary border border-border px-1.5 py-0.5 rounded-sm">{courseName(c.course_id) ?? 'предмет'}</span>}
                          {c.shared_unit_id && (
                            <span className="text-[10px] bg-info-bg text-info px-1.5 py-0.5 rounded-sm">
                              {isOwn
                                ? (sharedTarget ? `открыто: ${UNIT_TYPE_LABEL[sharedTarget.type_code] ?? sharedTarget.name}` : 'открыто')
                                : 'доступно вам'}
                            </span>
                          )}
                        </div>
                        {c.description && (
                          <div className="text-xs font-sans text-ink-tertiary mt-1 leading-relaxed line-clamp-3">{c.description}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 mt-3 pt-2 border-t border-border/60 space-y-2">
                        {isOwn && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(c)} className="text-xs font-medium text-info hover:text-info/80">Изменить</button>
                            <button onClick={() => { if (confirm(`Удалить критерий «${c.name}»?`)) deleteMut.mutate(c.id) }}
                              className="text-xs font-medium text-danger hover:text-danger/80">Удалить</button>
                          </div>
                        )}
                        {isOwn && shareTargets.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-ink-tertiary flex-shrink-0">Доступ:</span>
                            <Select
                              size="sm"
                              className="flex-1"
                              ariaLabel="Поделиться критерием"
                              value={c.shared_unit_id ?? ''}
                              onChange={(unitId) => unitId ? shareMut.mutate({ id: c.id, unitId }) : unshareMut.mutate(c.id)}
                              options={[
                                { value: '', label: 'Не делиться' },
                                ...shareTargets.map((t) => ({
                                  value: t.id,
                                  label: `${UNIT_TYPE_LABEL[t.type_code] ?? t.name}: «${t.name}»`,
                                })),
                              ]}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
