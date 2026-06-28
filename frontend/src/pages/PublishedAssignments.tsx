import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { usePlan } from '../hooks/usePlan'
import { useUIStore } from '../store/uiStore'
import {
  listPublishedAssignments, createPublishedAssignment,
  type PublishedStatus,
} from '../api/publishedAssignments'

const STATUS_LABEL: Record<PublishedStatus, string> = {
  draft: 'Черновик', open: 'Опубликовано', closed: 'Закрыто',
}
const STATUS_STYLE: Record<PublishedStatus, string> = {
  draft:  'bg-warning-bg text-warning',
  open:   'bg-success-bg text-success',
  closed: 'bg-surface-warm text-ink-tertiary',
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function PublishedAssignments() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const { can } = usePlan()
  const entitled = can('publishedAssignments')

  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dueAt, setDueAt] = useState('')

  const { data: assignments = [] } = useQuery({
    queryKey: ['published-assignments'],
    queryFn: listPublishedAssignments,
    enabled: entitled,
  })

  const createMut = useMutation({
    mutationFn: () => createPublishedAssignment({
      title: title.trim(),
      instructions: instructions.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    }),
    onSuccess: (pa) => {
      qc.invalidateQueries({ queryKey: ['published-assignments'] })
      addToast('Задание создано', 'success')
      navigate(`/published/${pa.id}`)
    },
  })

  function submit() {
    if (title.trim().length < 2) { addToast('Укажите название задания', 'error'); return }
    createMut.mutate()
  }

  if (!entitled) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center page-enter">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">Задания студентам</h1>
          <p className="font-sans text-sm text-ink-secondary mb-6">
            Публикуйте задания, которые студенты выполняют прямо на платформе. Система фиксирует процесс
            написания и формирует отчёт о подлинности — это функция тарифов Pro и Institution.
          </p>
          <Button onClick={() => navigate('/billing')}>Перейти на Pro</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Задания студентам</h1>
          <p className="text-sm font-sans text-ink-secondary mt-1">
            Опубликуйте задание — студенты пишут его на платформе по персональной ссылке
          </p>
        </div>

        <FeatureIntro
          id="published-assignments"
          title="Как это работает"
          description="Создайте задание и добавьте студентов. Каждый получит персональную ссылку, по которой пишет работу прямо на платформе — без регистрации. Система фиксирует процесс написания (время, правки, вставки) и формирует отчёт о подлинности, который вы видите при проверке."
          steps={[
            'Создайте задание с условием и сроком сдачи',
            'Добавьте студентов и отправьте им персональные ссылки',
            'Получите работы с отчётом о процессе написания и проверьте их',
          ]}
        />

        <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
          <button
            onClick={() => setCreating((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-surface-warm transition-colors"
          >
            <span className="text-sm font-sans font-medium text-ink">Новое задание</span>
            <span className="text-ink-tertiary text-lg leading-none">{creating ? '×' : '+'}</span>
          </button>
          {creating && (
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
              <label className="block">
                <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">Название</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Эссе по теме 3"
                  className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 outline-none focus:border-border-strong" />
              </label>
              <label className="block">
                <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">Условие задания</span>
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4}
                  placeholder="Что должны написать студенты…"
                  className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 outline-none focus:border-border-strong resize-y" />
              </label>
              <label className="block w-56">
                <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">Срок сдачи (необязательно)</span>
                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
                  className="w-full text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 outline-none focus:border-border-strong" />
              </label>
              <Button onClick={submit} loading={createMut.isPending}>Создать и перейти</Button>
            </div>
          )}
        </div>

        {assignments.length === 0 ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">
            Пока нет заданий. Создайте первое, чтобы студенты могли выполнить его на платформе.
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => (
              <button key={a.id} onClick={() => navigate(`/published/${a.id}`)}
                className="w-full text-left bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-mid hover:bg-surface-warm transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-sans font-medium text-ink truncate">{a.title}</span>
                    <span className={`text-[11px] font-sans px-1.5 py-0.5 rounded-sm ${STATUS_STYLE[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                  </div>
                  <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                    Сдано {a.submitted_count} из {a.invite_count} · срок {fmt(a.due_at)}
                  </div>
                </div>
                <span className="text-ink-tertiary text-sm flex-shrink-0">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
