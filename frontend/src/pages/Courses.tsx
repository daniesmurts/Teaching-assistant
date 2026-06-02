import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import Button from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import { getCourses, createCourse, updateCourse, deleteCourse } from '../api/courses'
import { useUIStore } from '../store/uiStore'
import type { Course } from '../types'

const LEVELS = [
  { value: '', label: 'No level' },
  { value: 'undergraduate_1', label: 'Undergraduate year 1–2' },
  { value: 'undergraduate_2', label: 'Undergraduate year 3–4' },
  { value: 'postgraduate',    label: 'Postgraduate' },
  { value: 'professional',    label: 'Professional' },
]

interface FormState {
  name: string; code: string; level: string; syllabus_text: string
}
const emptyForm: FormState = { name: '', code: '', level: '', syllabus_text: '' }

export default function Courses() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Course | null>(null)
  const [form, setForm]         = useState<FormState>(emptyForm)

  const { data: courses = [], isLoading } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const createMut = useMutation({
    mutationFn: createCourse,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); close() },
    onError:   () => addToast('Failed to create course', 'error'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormState> }) => updateCourse(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); close() },
    onError:   () => addToast('Failed to update course', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: deleteCourse,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
    onError:   () => addToast('Failed to delete course', 'error'),
  })

  function close() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  function openEdit(c: Course) {
    setEditing(c)
    setForm({ name: c.name, code: c.code ?? '', level: c.level ?? '', syllabus_text: c.syllabus_text ?? '' })
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = { ...form, code: form.code || undefined, level: form.level || undefined, syllabus_text: form.syllabus_text || undefined }
    if (editing) updateMut.mutate({ id: editing.id, data: payload })
    else createMut.mutate(payload)
  }

  const busy = createMut.isPending || updateMut.isPending

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Courses"
        subtitle={courses.length > 0 ? `${courses.length} course${courses.length !== 1 ? 's' : ''}` : undefined}
        actions={<Button size="sm" onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm) }}>+ New course</Button>}
      />

      <div className="flex-1 p-6 max-w-4xl w-full mx-auto">
        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <h3 className="font-sans text-sm font-medium text-ink mb-4">
              {editing ? 'Edit course' : 'New course'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Course name *"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Introduction to Computer Science"
                  required
                />
                <Input
                  label="Course code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="CS101"
                />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Level</label>
                <select
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
                >
                  {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <Textarea
                label="Syllabus (optional)"
                value={form.syllabus_text}
                onChange={(e) => setForm((f) => ({ ...f, syllabus_text: e.target.value }))}
                placeholder="Paste course syllabus text here…"
                rows={4}
              />
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Create course'}</Button>
                <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary">Loading…</div>
        ) : courses.length === 0 ? (
          <div className="text-center py-16">
            <div className="font-display text-4xl text-ink-tertiary mb-3">◫</div>
            <p className="font-sans text-sm text-ink-secondary">No courses yet.</p>
            <button onClick={() => setShowForm(true)} className="text-amber text-sm mt-1 hover:underline">
              Create your first course
            </button>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {courses.map((course, i) => (
              <div
                key={course.id}
                className={`flex items-center gap-4 px-4 py-3.5 ${i < courses.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-sm font-medium text-ink">{course.name}</span>
                    {course.code && (
                      <span className="text-xs font-sans text-ink-tertiary bg-surface-warm px-1.5 py-0.5 rounded-sm">
                        {course.code}
                      </span>
                    )}
                  </div>
                  {course.level && (
                    <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                      {LEVELS.find((l) => l.value === course.level)?.label ?? course.level}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(course)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={deleteMut.isPending}
                    onClick={() => { if (confirm(`Delete "${course.name}"?`)) deleteMut.mutate(course.id) }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
