import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CreateButton from '../components/ui/CreateButton'
import { Input, Textarea } from '../components/ui/Input'
import DocumentUpload from '../components/ui/DocumentUpload'
import { getCourses, createCourse, updateCourse, deleteCourse } from '../api/courses'
import { uploadAndWait } from '../api/documents'
import { useUIStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import ShareRagToggle from '../components/courses/ShareRagToggle'
import CourseMaterials from '../components/courses/CourseMaterials'
import PolicyMemoPanel from '../components/courses/PolicyMemoPanel'
import { usePlan } from '../hooks/usePlan'
import type { Course } from '../types'

const LEVELS = [
  { value: '', label: 'Не указан' },
  { value: 'undergraduate_1', label: 'Бакалавриат 1–2 курс' },
  { value: 'undergraduate_2', label: 'Бакалавриат 3–4 курс' },
  { value: 'postgraduate',    label: 'Магистратура / аспирантура' },
  { value: 'professional',    label: 'Дополнительное образование' },
]

interface FormState {
  name: string; code: string; level: string; syllabus_text: string; profession_context: string
}
const emptyForm: FormState = { name: '', code: '', level: '', syllabus_text: '', profession_context: '' }

export default function Courses() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const teacher = useAuthStore((s) => s.teacher)
  const plan = usePlan()
  // The per-course share toggle is meaningful only when the institution master
  // toggle is also on. Hide the column entirely otherwise — it's confusing
  // to show a toggle that does nothing.
  const sharingAllowed = !!teacher?.institution_id && !!teacher?.institution_shared_rag_enabled

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Course | null>(null)
  const [form, setForm]         = useState<FormState>(emptyForm)
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [expandedMemo, setExpandedMemo] = useState<string | null>(null)

  const { data: courses = [], isLoading } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const createMut = useMutation({
    mutationFn: createCourse,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); close() },
    onError:   () => addToast('Не удалось создать предмет', 'error'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormState> }) => updateCourse(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); close() },
    onError:   () => addToast('Не удалось обновить предмет', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: deleteCourse,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
    onError:   () => addToast('Не удалось удалить предмет', 'error'),
  })

  function close() { setShowForm(false); setEditing(null); setForm(emptyForm); setSyllabusFile(null) }

  function openEdit(c: Course) {
    setEditing(c)
    setForm({
      name: c.name, code: c.code ?? '', level: c.level ?? '', syllabus_text: c.syllabus_text ?? '',
      profession_context: c.profession_context ?? '',
    })
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      ...form,
      code: form.code || undefined,
      level: form.level || undefined,
      syllabus_text: form.syllabus_text || undefined,
      profession_context: form.profession_context || undefined,
    }

    if (editing) { updateMut.mutate({ id: editing.id, data: payload }); return }

    // New course: create first, then (if a syllabus file was picked) upload it to the new course
    setSubmitting(true)
    try {
      const course = await createCourse(payload)
      if (syllabusFile) {
        try {
          await uploadAndWait(syllabusFile, 'syllabus', course.id)
          addToast('Предмет создан, программа загружена и проиндексирована', 'success')
        } catch {
          addToast('Предмет создан, но не удалось обработать документ', 'error')
        }
      } else {
        addToast('Предмет создан', 'success')
      }
      qc.invalidateQueries({ queryKey: ['courses'] })
      close()
    } catch {
      addToast('Не удалось создать предмет', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || createMut.isPending || updateMut.isPending

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Предметы"
        subtitle={courses.length > 0 ? `${courses.length} ${courses.length === 1 ? 'предмет' : courses.length < 5 ? 'предмета' : 'предметов'}` : undefined}
        actions={<CreateButton onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm) }}>Новый предмет</CreateButton>}
      />

      <div className="flex-1 p-6 max-w-4xl w-full mx-auto">
        <FeatureIntro
          id="courses"
          title="Предметы — основа для проверки работ и презентаций"
          description="Предмет хранит контекст вашей дисциплины: уровень студентов и программу (силлабус). ИСПУМ использует его, чтобы точнее проверять работы и готовить лекции под ваш предмет."
          steps={[
            'Создайте предмет: укажите название, уровень и при желании загрузите силлабус (PDF или Word).',
            'Привяжите к предмету критерии оценки и работы студентов — так система накапливает примеры.',
            'Чем больше проверенных работ по предмету, тем точнее ИСПУМ оценивает новые (на тарифе Pro).',
          ]}
        />
        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <h3 className="font-sans text-sm font-medium text-ink mb-4">
              {editing ? 'Редактировать предмет' : 'Новый предмет'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Название предмета *"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Введение в программирование"
                  required
                />
                <Input
                  label="Код предмета"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="CS101"
                />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Уровень</label>
                <select
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
                >
                  {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <Textarea
                label="Программа предмета (необязательно)"
                value={form.syllabus_text}
                onChange={(e) => setForm((f) => ({ ...f, syllabus_text: e.target.value }))}
                placeholder="Вставьте текст программы предмета…"
                rows={4}
              />
              <div>
                <Input
                  label="Профессия выпускников (необязательно)"
                  value={form.profession_context}
                  onChange={(e) => setForm((f) => ({ ...f, profession_context: e.target.value }))}
                  placeholder="Например: юристы, бухгалтеры, инженеры-технологи"
                />
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-sans text-ink-secondary bg-amber-light/50 border border-amber/20 rounded-md px-2.5 py-1.5">
                  <span className="flex-shrink-0 leading-none">✦</span>
                  Задания, кейсы и тесты по этому предмету будут привязаны к рабочим ситуациям этой профессии
                </p>
              </div>

              {/* Syllabus upload — PDF/Word */}
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
                  Загрузить программу предмета (PDF / Word)
                </label>
                {editing ? (
                  <DocumentUpload
                    documentType="syllabus"
                    courseId={editing.id}
                    hint="Будет проиндексировано для подготовки лекций"
                    onReady={(doc) => {
                      if (doc.extractedText) setForm((f) => ({ ...f, syllabus_text: doc.extractedText! }))
                      addToast(
                        doc.chunkCount ? `Документ проиндексирован (${doc.chunkCount} фрагментов)` : 'Документ обработан',
                        'success'
                      )
                    }}
                  />
                ) : (
                  <DocumentUpload
                    documentType="syllabus"
                    defer
                    onFile={setSyllabusFile}
                    hint="Текст распознается автоматически при создании предмета"
                  />
                )}
              </div>

              {/* Materials — методички, чертежи, конспекты. Only once the
                  course exists (needs a real courseId); a new, unsaved
                  course has nothing to attach materials to yet. */}
              {editing && (
                <div>
                  <CourseMaterials courseId={editing.id} />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={busy}>{editing ? 'Сохранить' : 'Создать предмет'}</Button>
                <Button type="button" variant="secondary" onClick={close}>Отмена</Button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary">Загрузка…</div>
        ) : courses.length === 0 ? (
          <div className="text-center py-16">
            <div className="font-display text-4xl text-ink-tertiary mb-3">◫</div>
            <p className="font-sans text-sm text-ink-secondary">Предметов пока нет.</p>
            <button onClick={() => setShowForm(true)} className="text-amber text-sm mt-1 hover:underline">
              Создать первый предмет
            </button>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {courses.map((course, i) => (
              <div key={course.id} className={i < courses.length - 1 ? 'border-b border-border' : ''}>
                <div className="flex items-center gap-4 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-sans text-sm font-medium text-ink">{course.name}</span>
                      {course.code && (
                        <span className="text-xs font-sans text-ink-tertiary bg-surface-warm px-1.5 py-0.5 rounded-sm">
                          {course.code}
                        </span>
                      )}
                    </div>
                    {(course.level || course.profession_context) && (
                      <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                        {[
                          course.level ? (LEVELS.find((l) => l.value === course.level)?.label ?? course.level) : null,
                          course.profession_context ? `для: ${course.profession_context}` : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {sharingAllowed && <ShareRagToggle course={course} />}
                    {plan.can('ragFlywheel') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setExpandedMemo((id) => id === course.id ? null : course.id)}
                      >
                        {expandedMemo === course.id ? 'Скрыть профиль' : 'Профиль оценивания'}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => openEdit(course)}>Изменить</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={deleteMut.isPending}
                      onClick={() => { if (confirm(`Удалить предмет «${course.name}»?`)) deleteMut.mutate(course.id) }}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
                {expandedMemo === course.id && (
                  <div className="px-4 pb-3.5">
                    <PolicyMemoPanel courseId={course.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
