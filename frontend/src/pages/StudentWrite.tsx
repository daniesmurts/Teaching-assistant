import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SubmissionTelemetry } from '../types'
import {
  getWriteState, acceptConsent, saveDraft, submitWrite, type WriteState,
} from '../api/publicWrite'

const IDLE_MS     = 30_000    // gaps longer than this don't count as active writing
const AUTOSAVE_MS = 1_500     // debounce after the last keystroke
const SNAPSHOT_MS = 90_000    // capture a trajectory snapshot at most this often

// Full-screen shell with no teacher chrome.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-6 py-10">{children}</div>
    </div>
  )
}

function Centered({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <Shell>
      <div className="text-center py-20 page-enter">
        <div className="text-4xl mb-3">{icon}</div>
        <h1 className="font-display text-2xl font-bold text-ink mb-2">{title}</h1>
        {text && <p className="font-sans text-sm text-ink-secondary max-w-md mx-auto">{text}</p>}
      </div>
    </Shell>
  )
}

export default function StudentWrite() {
  const { token = '' } = useParams()
  const [state, setState] = useState<WriteState | null>(null)
  const [error, setError] = useState<'notfound' | 'load' | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let alive = true
    getWriteState(token)
      .then((s) => { if (alive) { setState(s); setSubmitted(s.submitted) } })
      .catch((e) => { if (alive) setError(e?.response?.status === 404 ? 'notfound' : 'load') })
    return () => { alive = false }
  }, [token])

  const acceptMut = useCallback(async () => {
    if (!state) return
    await acceptConsent(token, state.consent_version)
    setState({ ...state, consent_given: true, status: 'writing' })
  }, [state, token])

  if (error === 'notfound') return <Centered icon="🔗" title="Ссылка недействительна" text="Проверьте ссылку или попросите преподавателя прислать новую." />
  if (error === 'load')     return <Centered icon="⚠️" title="Не удалось загрузить задание" text="Попробуйте обновить страницу." />
  if (!state)               return <Centered icon="…" title="Загрузка…" />

  if (submitted)                       return <Centered icon="✓" title="Работа сдана" text="Спасибо! Ваша работа отправлена преподавателю." />
  if (state.assignment.status === 'draft')  return <Centered icon="⏳" title="Задание ещё не открыто" text="Преподаватель пока не опубликовал это задание. Загляните позже." />
  if (state.assignment.status === 'closed') return <Centered icon="🔒" title="Приём работ закрыт" text="Срок сдачи этого задания истёк." />

  if (!state.consent_given) return <ConsentGate state={state} onAccept={acceptMut} />

  return <Composer token={token} state={state} onSubmitted={() => setSubmitted(true)} />
}

// ─── Consent gate (§5.1.2) ────────────────────────────────────────────────────

function ConsentGate({ state, onAccept }: { state: WriteState; onAccept: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Shell>
      <div className="page-enter">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">{state.assignment.title}</h1>
        {state.student_name && <p className="text-sm font-sans text-ink-secondary mb-6">{state.student_name}</p>}

        <div className="bg-surface border border-border rounded-lg p-5 mb-5">
          <h2 className="font-sans text-sm font-medium text-ink mb-2">Несколько слов перед началом</h2>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed mb-3">
            Вы пишете работу прямо на этой странице — черновик <strong>сохраняется автоматически</strong>,
            поэтому ничего не потеряется, даже если вы закроете вкладку и вернётесь позже.
          </p>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed mb-3">
            Чтобы преподаватель видел, что это <strong>ваша самостоятельная работа</strong>, платформа
            сохраняет обобщённые сведения о процессе: сколько времени вы писали и как дорабатывали текст.
            Отдельные нажатия клавиш не записываются — только эти общие показатели.
          </p>
          <p className="font-sans text-xs text-ink-tertiary">
            Начиная работу, вы соглашаетесь с сохранением этих сведений. Подробнее — в{' '}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
              Политике конфиденциальности
            </Link>.
          </p>
        </div>

        <button
          onClick={async () => { setBusy(true); try { await onAccept() } finally { setBusy(false) } }}
          disabled={busy}
          className="px-5 py-2.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {busy ? 'Подождите…' : 'Начать работу'}
        </button>
      </div>
    </Shell>
  )
}

// ─── Composer (TipTap + telemetry + autosave + submit) ────────────────────────

function freshTelemetry(): SubmissionTelemetry {
  return {
    total_chars: 0, active_ms: 0, revision_count: 0,
    paste_count: 0, pasted_chars: 0, largest_paste: 0,
    started_at: '', last_edit_at: '',
  }
}

function Composer({ token, state, onSubmitted }: {
  token: string; state: WriteState; onSubmitted: () => void
}) {
  const tele = useRef<SubmissionTelemetry>(freshTelemetry())
  const lastEditTs = useRef<number>(0)
  const lastSnapshotTs = useRef<number>(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [online, setOnline] = useState(navigator.onLine)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const editor = useEditor({
    extensions: [StarterKit],
    content: (state.draft_content as object) ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'student-prose outline-none min-h-[420px]' },
      // Measure pasted text so a wholesale paste shows up in the provenance facts.
      handlePaste: (_view, _event, slice) => {
        const len = slice.content.textBetween(0, slice.content.size, '\n').length
        if (len > 0) {
          tele.current.paste_count  += 1
          tele.current.pasted_chars += len
          tele.current.largest_paste = Math.max(tele.current.largest_paste, len)
        }
        return false   // let the default paste proceed
      },
    },
    onUpdate: ({ editor }) => recordEdit(editor),
  })

  function recordEdit(ed: Editor) {
    const now = Date.now()
    const t = tele.current
    if (!t.started_at) t.started_at = new Date(now).toISOString()
    if (lastEditTs.current && now - lastEditTs.current < IDLE_MS) t.active_ms += now - lastEditTs.current
    lastEditTs.current = now
    t.last_edit_at = new Date(now).toISOString()
    t.revision_count += 1
    t.total_chars = ed.getText().length
    scheduleSave(ed)
  }

  const scheduleSave = useCallback((ed: Editor) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const now = Date.now()
      const wantSnapshot = now - lastSnapshotTs.current > SNAPSHOT_MS
      setSaveStatus('saving')
      try {
        await saveDraft(token, { draft_content: ed.getJSON(), telemetry: tele.current, snapshot: wantSnapshot })
        if (wantSnapshot) lastSnapshotTs.current = now
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, AUTOSAVE_MS)
  }, [token])

  async function submit() {
    if (!editor) return
    if (editor.getText().trim().length < 1) return
    if (!confirm('Сдать работу? После отправки изменить её будет нельзя.')) return
    setSubmitting(true)
    try {
      await submitWrite(token, { draft_content: editor.getJSON(), telemetry: tele.current })
      onSubmitted()
    } catch {
      setSubmitting(false)
      alert('Не удалось отправить работу. Проверьте соединение и попробуйте снова.')
    }
  }

  const saveLabel = saveStatus === 'saving' ? 'Сохранение…'
    : saveStatus === 'saved' ? 'Сохранено'
    : saveStatus === 'error' ? 'Ошибка сохранения' : ''

  return (
    <Shell>
      <div className="page-enter">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">{state.assignment.title}</h1>
        {state.assignment.instructions && (
          <p className="text-sm font-sans text-ink-secondary whitespace-pre-wrap mb-5">{state.assignment.instructions}</p>
        )}

        {!online && (
          <div className="mb-4 text-xs font-sans bg-warning-bg text-warning px-3 py-2 rounded-md">
            Нет подключения к интернету. Работа сохраняется только при наличии связи — не закрывайте страницу.
          </div>
        )}

        {/* Minimal toolbar */}
        {editor && (
          <div className="flex items-center gap-1 mb-2">
            <TBtn active={editor.isActive('bold')}   onClick={() => editor.chain().focus().toggleBold().run()}><b>Ж</b></TBtn>
            <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>К</i></TBtn>
            <TBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</TBtn>
            <TBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</TBtn>
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg p-5 font-sans text-[15px] text-ink leading-relaxed">
          <EditorContent editor={editor} />
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-xs font-sans text-ink-tertiary">{saveLabel}</span>
          <button
            onClick={submit}
            disabled={submitting || !online}
            title={!online ? 'Нет подключения' : undefined}
            className="px-5 py-2.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {submitting ? 'Отправка…' : 'Сдать работу'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

function TBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-md text-sm font-sans transition-colors ${
        active ? 'bg-amber-light text-amber' : 'text-ink-secondary hover:bg-surface-warm'
      }`}>
      {children}
    </button>
  )
}
