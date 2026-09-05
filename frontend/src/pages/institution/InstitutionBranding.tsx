import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import Icon from '../../components/ui/Icon'
import { useUIStore } from '../../store/uiStore'
import {
  getInstitutionBranding, setInstitutionAccentColor,
  uploadInstitutionLogo, deleteInstitutionLogo,
} from '../../api/institution'

/**
 * Фирменный стиль на слайдах (migration 125).
 *
 * A generated deck leaves the platform and gets projected in a lecture hall,
 * shown at a defence, or sent to a кафедра — and until now every one of them
 * looked like ИСПУМ. The accent colour and the logo on the титульный лист are
 * what actually make it look like the university instead.
 *
 * Deliberately two settings, not a theme editor: those two appear on a slide,
 * and anything more would be a design surface every institution then has to
 * fill in correctly.
 */
export default function InstitutionBranding() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [colour, setColour] = useState('#C8860A')
  // Cache-busts the logo <img> after an upload or removal: the URL never
  // changes, so the browser would otherwise keep showing the old crest.
  const [logoVersion, setLogoVersion] = useState(0)

  const { data, isLoading } = useQuery({ queryKey: ['institution-branding'], queryFn: getInstitutionBranding })

  useEffect(() => {
    if (data?.accent_color) setColour(data.accent_color)
  }, [data?.accent_color])

  const colourMut = useMutation({
    mutationFn: (next: string | null) => setInstitutionAccentColor(next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institution-branding'] })
      addToast('Цвет сохранён', 'success')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(message ?? 'Не удалось сохранить цвет', 'error')
    },
  })

  const logoMut = useMutation({
    mutationFn: (file: File) => uploadInstitutionLogo(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institution-branding'] })
      setLogoVersion((v) => v + 1)
      addToast('Логотип загружен', 'success')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(message ?? 'Не удалось загрузить логотип', 'error')
    },
  })

  const removeMut = useMutation({
    mutationFn: deleteInstitutionLogo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institution-branding'] })
      setLogoVersion((v) => v + 1)
      addToast('Логотип удалён', 'success')
    },
    onError: () => addToast('Не удалось удалить логотип', 'error'),
  })

  if (isLoading || !data) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 text-sm font-sans text-ink-tertiary">Загрузка…</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6 page-enter">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Фирменный стиль</h1>
          <p className="text-sm font-sans text-ink-secondary mt-1 max-w-[68ch]">
            Как выглядят презентации, которые преподаватели {data.name} выгружают в PowerPoint:
            акцентный цвет на слайдах и логотип на титульном листе. На сами слайды и текст
            лекций это не влияет.
          </p>
        </div>

        {/* Accent colour */}
        <div className="bg-surface border border-border rounded-lg p-5">
          <h2 className="font-sans text-sm font-medium text-ink mb-1">Акцентный цвет</h2>
          <p className="text-xs font-sans text-ink-secondary mb-3 max-w-[62ch]">
            Полоса заголовка, подписи и выделения на слайдах. Пусто — фирменный цвет ИСПУМ.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              aria-label="Акцентный цвет"
              className="w-11 h-11 rounded-md border border-border bg-surface cursor-pointer"
            />
            <input
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              aria-label="Акцентный цвет в формате HEX"
              placeholder="#1A4D8F"
              className="w-32 px-2.5 py-2 text-sm font-mono text-ink bg-surface border border-border rounded-md outline-none focus:border-border-strong"
            />
            <Button size="sm" loading={colourMut.isPending} onClick={() => colourMut.mutate(colour)}>
              Сохранить
            </Button>
            {data.accent_color && (
              <button
                onClick={() => colourMut.mutate(null)}
                disabled={colourMut.isPending}
                className="text-xs font-sans text-ink-secondary hover:text-danger transition-colors disabled:opacity-40"
              >
                Вернуть цвет ИСПУМ
              </button>
            )}
          </div>

          {/* What the header bar of every slide will look like. */}
          <div className="mt-4 border border-border rounded-md overflow-hidden max-w-[320px]">
            <div className="h-1.5" style={{ backgroundColor: colour }} />
            <div className="px-3 py-2.5 bg-white">
              <div className="font-display text-sm font-bold text-ink">Заголовок слайда</div>
              <div className="text-[11px] font-sans mt-0.5" style={{ color: colour }}>подпись акцентом</div>
            </div>
          </div>
        </div>

        {/* Logo */}
        <div className="bg-surface border border-border rounded-lg p-5">
          <h2 className="font-sans text-sm font-medium text-ink mb-1">Логотип на титульном листе</h2>
          <p className="text-xs font-sans text-ink-secondary mb-3 max-w-[62ch]">
            PNG или JPEG, до 2 МБ. Ставится по центру над названием лекции. Лучше всего смотрится
            горизонтальный логотип на прозрачном или тёмном фоне — титульный лист тёмный.
          </p>

          <div className="flex items-center gap-4 flex-wrap">
            {data.has_logo && (
              <div className="bg-ink rounded-md px-4 py-3 flex items-center justify-center">
                <img
                  src={`/api/institution/branding/logo?v=${logoVersion}`}
                  alt={`Логотип ${data.name}`}
                  className="max-h-12 max-w-[180px] object-contain"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" loading={logoMut.isPending} onClick={() => fileRef.current?.click()}>
                <Icon name="import" size={14} />
                {data.has_logo ? 'Заменить' : 'Загрузить логотип'}
              </Button>
              {data.has_logo && (
                <button
                  onClick={() => removeMut.mutate()}
                  disabled={removeMut.isPending}
                  className="text-xs font-sans text-ink-secondary hover:text-danger transition-colors disabled:opacity-40"
                >
                  Удалить
                </button>
              )}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) logoMut.mutate(file)
            }}
          />
        </div>
      </div>
    </div>
  )
}
