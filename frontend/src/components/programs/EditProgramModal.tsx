import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateProgram } from '../../api/programs'
import { useUIStore } from '../../store/uiStore'
import { EDUCATION_LEVELS, STUDY_FORMS } from '../../types'
import type { Program } from '../../types'

// Fixes the dead end this was built for: a typo'd «Код» or misspelt
// «Наименование» at intake had no way to be corrected afterwards, and
// silently broke sveden-page discipline matching (matchDiscipline keys on
// name/code) and ФГОС-code lookups — the import just kept failing with no
// visible reason. `name` and `specialty_name` are kept in sync on save: the
// intake flow sets name := specialty_name at creation (routes/programs.ts),
// and the detail page header reads `name` while the list/cards read
// `specialty_name` — editing only one would silently desync the two titles.
export default function EditProgramModal({ program, onClose }: { program: Program; onClose: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const qc = useQueryClient()

  const [code, setCode]                 = useState(program.code ?? '')
  const [specialtyName, setSpecialtyName] = useState(program.specialty_name ?? program.name ?? '')
  const [educationLevel, setEducationLevel] = useState(program.education_level ?? '')
  const [profile, setProfile]           = useState(program.profile ?? '')
  const [forms, setForms]               = useState(program.forms_of_study ?? '')

  const saveMut = useMutation({
    mutationFn: () => updateProgram(program.id, {
      name:            specialtyName.trim(),
      specialty_name:  specialtyName.trim(),
      code:            code.trim() || null,
      education_level: educationLevel.trim() || null,
      profile:         profile.trim() || null,
      forms_of_study:  forms.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] })
      qc.invalidateQueries({ queryKey: ['program', program.id] })
      addToast('Программа обновлена', 'success')
      onClose()
    },
  })

  function submit() {
    if (specialtyName.trim().length < 2) {
      addToast('Укажите наименование специальности/направления', 'error')
      return
    }
    saveMut.mutate()
  }

  const formsSet = new Set(forms.split(',').map((s) => s.trim()).filter(Boolean))

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={saveMut.isPending ? undefined : onClose} />

      <div className="relative bg-surface rounded-xl border border-border max-w-lg w-full p-6 animate-[resultAppear_250ms_ease_forwards] max-h-[85vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={saveMut.isPending}
          className="absolute top-4 right-4 text-ink-tertiary hover:text-ink transition-colors text-lg leading-none disabled:opacity-40"
        >
          ×
        </button>

        <h2 className="font-display text-xl font-bold text-ink mb-1">Редактировать программу</h2>
        <p className="text-xs font-sans text-ink-tertiary mb-4">
          Исправьте код или название, если они были введены с ошибкой — например, если импорт по ссылке не находит совпадений.
        </p>

        <div className="space-y-3">
          <Field label="Код" value={code} onChange={setCode} placeholder="09.03.01" mono />
          <Field
            label="Наименование профессии / специальности / направления подготовки / группы научных специальностей"
            value={specialtyName} onChange={setSpecialtyName}
            placeholder="Информатика и вычислительная техника"
          />
          <label className="block">
            <span className="text-xs font-sans text-ink-secondary block mb-1">Уровень образования</span>
            <select
              value={educationLevel} onChange={(e) => setEducationLevel(e.target.value)}
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-2 outline-none focus:border-border-strong"
            >
              <option value="">— выберите —</option>
              {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              {educationLevel && !EDUCATION_LEVELS.includes(educationLevel) && (
                <option value={educationLevel}>{educationLevel}</option>
              )}
            </select>
          </label>
          <Field
            label="Образовательная программа / направленность / профиль, шифр и наименование научной специальности"
            value={profile} onChange={setProfile} placeholder="Профиль «Программная инженерия»"
          />
          <div>
            <span className="text-xs font-sans text-ink-secondary block mb-1">Реализуемые формы обучения</span>
            <div className="flex flex-wrap gap-3">
              {STUDY_FORMS.map((f) => (
                <label key={f} className="inline-flex items-center gap-1.5 text-sm font-sans text-ink cursor-pointer">
                  <input
                    type="checkbox" checked={formsSet.has(f)}
                    onChange={() => {
                      const next = new Set(formsSet)
                      if (next.has(f)) next.delete(f); else next.add(f)
                      setForms(STUDY_FORMS.filter((x) => next.has(x)).join(', '))
                    }}
                    className="accent-amber"
                  />
                  {f}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={submit}
            disabled={saveMut.isPending}
            className="px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveMut.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            onClick={onClose}
            disabled={saveMut.isPending}
            className="text-sm font-sans text-ink-secondary hover:text-ink transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
