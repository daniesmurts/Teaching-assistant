import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { parseInstructions } from '../lib/assignmentInstructions'
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
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">{children}</div>
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
          <Instructions text={state.assignment.instructions} />
        )}

        {!online && (
          <div className="mb-4 text-xs font-sans bg-warning-bg text-warning px-3 py-2 rounded-md">
            Нет подключения к интернету. Работа сохраняется только при наличии связи — не закрывайте страницу.
          </div>
        )}

        {/* Minimal toolbar */}
        {editor && (
          <div className="flex items-center gap-1 mb-2">
            <TBtn label="Полужирный" active={editor.isActive('bold')}   onClick={() => editor.chain().focus().toggleBold().run()}><b>Ж</b></TBtn>
            <TBtn label="Курсив"     active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>К</i></TBtn>
            <TBtn label="Подзаголовок" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</TBtn>
            <TBtn label="Список"     active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</TBtn>
          </div>
        )}

        {/* 16px, not 15: iOS zooms the viewport when a focused editable is
            under 16px, which on a phone throws the student out of their own
            line as soon as they start typing. */}
        <div className="bg-surface border border-border rounded-lg p-4 sm:p-5 font-sans text-base text-ink leading-relaxed">
          <EditorContent editor={editor} />
        </div>

        {/* Sticky on a phone ONLY (sm:static): the editor is 420px tall by
            design, so on a small screen «Сдать работу» otherwise sits below the
            fold for the whole session, and the save status — the thing that
            tells a student their work is safe — goes with it. On a desktop the
            whole page fits, and leaving it sticky floated the button over the
            editor the student is typing into. */}
        <div className="sticky sm:static bottom-0 -mx-4 sm:mx-0 mt-4 px-4 sm:px-0 py-3 sm:py-0 bg-bg/95 backdrop-blur-sm border-t border-border sm:border-0 sm:bg-transparent sm:backdrop-blur-none flex items-center justify-between gap-3">
          <span className="text-xs font-sans text-ink-secondary" aria-live="polite">{saveLabel}</span>
          <button
            onClick={submit}
            disabled={submitting || !online}
            title={!online ? 'Нет подключения' : undefined}
            className="min-h-[44px] px-5 py-2.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
          >
            {submitting ? 'Отправка…' : 'Сдать работу'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

// 44×44 on touch, tightened to 36 on a pointer. These were 32px squares —
// under the touch-target floor, on the controls a student on a phone uses
// most. They also had no accessible name: «Ж» is a letter, not a label.
function TBtn({ children, active, label, onClick }: {
  children: React.ReactNode; active: boolean; label: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-md text-sm font-sans transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
        active ? 'bg-amber-light text-amber' : 'text-ink-secondary hover:bg-surface-warm'
      }`}>
      {children}
    </button>
  )
}

// Instructions rendered with the hierarchy the plain text implies: the
// question carries its number and the page's ink colour, its sub-questions sit
// under it as a real list, and the framing paragraphs stay secondary. 16px
// (not 14) because this is reading matter on a phone, and capped near 68
// characters so a wide screen doesn't stretch it past a comfortable measure.
function Instructions({ text }: { text: string }) {
  const blocks = parseInstructions(text)
  if (blocks.length === 0) return null

  return (
    <div className="max-w-[68ch] mb-6 space-y-4">
      {blocks.map((block, i) =>
        block.kind === 'question' ? (
          <div key={i} className="flex gap-2.5">
            <span
              aria-hidden
              className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber-light text-amber font-sans text-xs font-semibold flex items-center justify-center"
            >
              {block.number}
            </span>
            <div className="min-w-0">
              <p className="font-sans text-base text-ink font-medium leading-relaxed">{block.text}</p>
              {block.prompts.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {block.prompts.map((prompt, j) => (
                    <li key={j} className="font-sans text-[15px] text-ink-secondary leading-relaxed flex gap-2">
                      <span aria-hidden className="text-ink-tertiary flex-shrink-0">—</span>
                      <span>{prompt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p key={i} className="font-sans text-base text-ink-secondary leading-relaxed">{block.text}</p>
        )
      )}
    </div>
  )
}
