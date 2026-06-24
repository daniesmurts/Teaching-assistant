import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FeatureIntro from '../../components/ui/FeatureIntro'
import Button from '../../components/ui/Button'
import { listPrograms, importProgram } from '../../api/programs'
import { useUIStore } from '../../store/uiStore'
import type { ProgramLevel } from '../../types'

const LEVEL_LABEL: Record<ProgramLevel, string> = {
  bachelor: 'Бакалавриат', master: 'Магистратура', specialist: 'Специалитет',
}

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function InstitutionPrograms() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [specialtyName, setSpecialtyName] = useState('')
  const [educationLevel, setEducationLevel] = useState('')
  const [profile, setProfile] = useState('')
  const [forms, setForms] = useState('')
  const [descFile, setDescFile] = useState<File | null>(null)
  const [planFile, setPlanFile] = useState<File | null>(null)
  const descRef = useRef<HTMLInputElement>(null)
  const planRef = useRef<HTMLInputElement>(null)

  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: listPrograms })

  const importMut = useMutation({
    mutationFn: () => importProgram({
      code: code.trim(),
      specialty_name: specialtyName.trim(),
      education_level: educationLevel.trim(),
      profile: profile.trim(),
      forms_of_study: forms.trim(),
      description: descFile,
      plan: planFile as File,
    }),
    onSuccess: ({ program, imported, warnings }) => {
      qc.invalidateQueries({ queryKey: ['programs'] })
      addToast(`Импортировано: ${imported.disciplines} дисциплин, ${imported.competencies} компетенций`, 'success')
      if (warnings && warnings.length > 0) addToast(warnings[0], 'info')
      navigate(`/institution/programs/${program.id}`)
    },
  })

  function submit() {
    if (specialtyName.trim().length < 2) { addToast('Укажите наименование специальности/направления', 'error'); return }
    if (!planFile) { addToast('Загрузите файл учебного плана (PDF)', 'error'); return }
    importMut.mutate()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Образовательные программы</h1>
          <p className="text-sm font-sans text-ink-secondary mt-1">
            Анализ архитектуры образовательных программ — последовательность, компетенции, пробелы
          </p>
        </div>

        <FeatureIntro
          id="programs"
          title="Как это работает"
          description="Заполните карточку образовательной программы и загрузите два документа: описание ОП (из него извлекаются компетенции и цели) и учебный план (из него — дисциплины по семестрам). Система проверит логику последовательности дисциплин, формирование компетенций по годам, пробелы и избыточность."
          steps={[
            'Заполните реквизиты программы и загрузите описание ОП и учебный план (PDF)',
            'Система извлекает дисциплины и компетенции из документов',
            'Запустите анализ — последовательность, карта компетенций и рекомендации',
          ]}
        />

        {/* Intake */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
          <button
            onClick={() => setCreating((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-surface-warm transition-colors"
          >
            <span className="text-sm font-sans font-medium text-ink">Новая программа — импорт из документов</span>
            <span className="text-ink-tertiary text-lg leading-none">{creating ? '×' : '+'}</span>
          </button>

          {creating && (
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
              <Field label="Код" value={code} onChange={setCode} placeholder="09.03.01" mono />
              <Field
                label="Наименование профессии / специальности / направления подготовки / группы научных специальностей"
                value={specialtyName} onChange={setSpecialtyName}
                placeholder="Информатика и вычислительная техника"
              />
              <Field label="Уровень образования" value={educationLevel} onChange={setEducationLevel}
                placeholder="Высшее образование — бакалавриат" />
              <Field
                label="Образовательная программа / направленность / профиль, шифр и наименование научной специальности"
                value={profile} onChange={setProfile} placeholder="Профиль «Программная инженерия»"
              />
              <Field label="Реализуемые формы обучения" value={forms} onChange={setForms}
                placeholder="очная, очно-заочная" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <FileField
                  label="Описание образовательной программы (PDF)"
                  file={descFile} inputRef={descRef}
                  onPick={(f) => setDescFile(f)}
                />
                <FileField
                  label="Учебный план (PDF) — обязательно"
                  file={planFile} inputRef={planRef}
                  onPick={(f) => setPlanFile(f)}
                  required
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button onClick={submit} loading={importMut.isPending}>Импортировать и перейти</Button>
                <span className="text-xs font-sans text-ink-tertiary">
                  Извлечение и разбор документов могут занять 1–2 минуты
                </span>
              </div>
            </div>
          )}
        </div>

        {/* List */}
        {programs.length === 0 ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">
            Пока нет учебных планов. Импортируйте первую программу, чтобы проанализировать её архитектуру.
          </div>
        ) : (
          <div className="space-y-2">
            {programs.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/institution/programs/${p.id}`)}
                className="w-full text-left bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-mid hover:bg-surface-warm transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans font-medium text-ink truncate">{p.specialty_name || p.name}</div>
                  <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                    {p.code && <span>{p.code} · </span>}
                    {p.education_level
                      ? <span>{p.education_level} · </span>
                      : p.level && <span>{LEVEL_LABEL[p.level]} · </span>}
                    {p.duration_semesters} сем. · обновлён {fmt(p.updated_at)}
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

function Field({ label, value, onChange, placeholder, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">{label}</span>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full text-sm bg-surface border border-border rounded-md px-3 py-2 focus:border-border-strong outline-none ${mono ? 'font-mono' : 'font-sans'}`}
      />
    </label>
  )
}

function FileField({ label, file, onPick, inputRef, required = false }: {
  label: string; file: File | null; onPick: (f: File | null) => void
  inputRef: React.RefObject<HTMLInputElement>; required?: boolean
}) {
  return (
    <div>
      <span className="text-xs font-sans font-medium text-ink-secondary block mb-1">{label}</span>
      <input
        ref={inputRef} type="file" accept="application/pdf" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`w-full text-left text-sm font-sans rounded-md px-3 py-2 border transition-colors truncate ${
          file ? 'border-amber/40 bg-amber-light/40 text-ink' : 'border-dashed border-border-mid text-ink-tertiary hover:bg-surface-warm'
        }`}
      >
        {file ? `📄 ${file.name}` : (required ? 'Выбрать PDF…' : 'Выбрать PDF (необязательно)…')}
      </button>
    </div>
  )
}
