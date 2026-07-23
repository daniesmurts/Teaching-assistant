import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listPrograms, getMarketEvidence, generateMarketEvidence, updateMarketEvidence, getSupportedRegions } from '../api/programs'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import MultiSelect from '../components/ui/MultiSelect'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Icon from '../components/ui/Icon'
import { useUIStore } from '../store/uiStore'

// РОП Студия v0 (TODO.md Feature Z, Phase 0 pilot) — generates one
// citation-grounded «обоснование актуальности» section per programme from
// real trudvsem.ru vacancy data + the direction's профстандарты (ФГОС
// registry, Feature AA). AI drafts, РОП is author of record — nothing here
// gets used in an official document until the РОП reviews/edits it; the
// «Источники» block always shows the raw numbers the text was built from so
// that review is a direct check against real data, not a matching algorithm.

// Region list comes from the backend (services/labourMarket.ts's
// SUPPORTED_REGIONS, GET /api/institution/programs/regions) — every one of
// its ~90 codes was individually confirmed against a live trudvsem query,
// so this fetches rather than duplicates that list here.
export default function RopStudio() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [programId, setProgramId] = useState<string | null>(null)
  const [regionCodes, setRegionCodes] = useState<string[]>([])
  const [professionsInput, setProfessionsInput] = useState('')
  const [editedText, setEditedText] = useState<string | null>(null)

  const { data: regions = [] } = useQuery({ queryKey: ['market-evidence-regions'], queryFn: getSupportedRegions })
  useEffect(() => {
    if (regionCodes.length === 0 && regions.length > 0) setRegionCodes([regions[0].code])
  }, [regions, regionCodes])

  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: listPrograms })
  const { data: evidence, isLoading: loadingEvidence } = useQuery({
    queryKey: ['market-evidence', programId],
    queryFn: () => getMarketEvidence(programId!),
    enabled: !!programId,
  })

  const generateMut = useMutation({
    mutationFn: () => generateMarketEvidence(programId!, {
      regionCodes,
      professions: professionsInput.split(',').map((p) => p.trim()).filter(Boolean),
    }),
    onSuccess: (data) => {
      qc.setQueryData(['market-evidence', programId], data)
      setEditedText(null)
      addToast('Обоснование сгенерировано', 'success')
    },
    onError: () => addToast('Не удалось сгенерировать обоснование', 'error'),
  })

  const saveMut = useMutation({
    mutationFn: (text: string) => updateMarketEvidence(programId!, evidence!.id, text),
    onSuccess: (data) => {
      qc.setQueryData(['market-evidence', programId], data)
      setEditedText(null)
      addToast('Сохранено', 'success')
    },
    onError: () => addToast('Не удалось сохранить', 'error'),
  })

  const selectedProgram = programs.find((p) => p.id === programId)
  const text = editedText ?? evidence?.section_text ?? ''
  const dirty = editedText !== null && editedText !== evidence?.section_text

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">РОП Студия</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Обоснование актуальности программы — на основе реальных данных о вакансиях и профстандартов направления.
          </p>
        </div>

        <div className="max-w-sm">
          <Select
            value={programId ?? ''}
            onChange={(v) => { setProgramId(v || null); setEditedText(null) }}
            options={programs.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}`.trim() }))}
            placeholder="Выберите программу…"
            ariaLabel="Программа"
          />
        </div>

        {programId && (
          <>
            <section className="bg-surface border border-border rounded-lg p-4 space-y-3">
              <h2 className="font-sans text-sm font-semibold text-ink">Сгенерировать обоснование</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">Регионы</span>
                  <MultiSelect
                    values={regionCodes}
                    onChange={setRegionCodes}
                    options={regions.map((r) => ({ value: r.code, label: r.name }))}
                    placeholder="Выберите регионы…"
                    ariaLabel="Регионы"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-sans font-medium text-ink-secondary mb-1">
                    Профессии для поиска вакансий
                  </span>
                  <input
                    value={professionsInput}
                    onChange={(e) => setProfessionsInput(e.target.value)}
                    placeholder="инженер-технолог, технолог"
                    className="w-full px-3 py-2 text-sm font-sans bg-canvas border border-border rounded-md focus:outline-none focus:border-border-strong"
                  />
                </label>
              </div>
              <p className="text-xs font-sans text-ink-tertiary">
                Через запятую — например, названия должностей, типичных для выпускников этого направления.
              </p>
              <Button
                loading={generateMut.isPending}
                disabled={!professionsInput.trim() || regionCodes.length === 0}
                onClick={() => generateMut.mutate()}
              >
                {evidence ? 'Обновить' : 'Сгенерировать'}
              </Button>
            </section>

            {loadingEvidence ? (
              <p className="text-sm font-sans text-ink-tertiary">Загрузка…</p>
            ) : generateMut.isPending ? (
              <div className="flex items-center gap-2 text-sm font-sans text-ink-secondary py-4">
                <LoadingSpinner size={16} />
                Собираем данные о вакансиях и составляем текст…
              </div>
            ) : evidence ? (
              <>
                <section className="bg-surface border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="font-sans text-sm font-semibold text-ink">Обоснование актуальности</h2>
                      <span className="inline-flex items-center gap-1 flex-shrink-0 text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">
                        <Icon name="sparkle" size={10} />
                        Черновик 
                      </span>
                    </div>
                    <span className="text-xs font-sans text-ink-tertiary truncate">
                      {selectedProgram?.name}
                    </span>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setEditedText(e.target.value)}
                    rows={10}
                    className="w-full px-3 py-2.5 text-sm font-sans text-ink leading-relaxed bg-canvas border border-border rounded-md focus:outline-none focus:border-border-strong resize-y"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-sans text-ink-tertiary">
                      Проверьте текст перед использованием в документе — источники приведены ниже.
                    </p>
                    <Button
                      size="sm"
                      loading={saveMut.isPending}
                      disabled={!dirty}
                      onClick={() => saveMut.mutate(text)}
                    >
                      {dirty ? 'Сохранить' : 'Сохранено'}
                    </Button>
                  </div>
                </section>

                <section className="bg-surface border border-border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-y-1">
                    <h2 className="font-sans text-sm font-semibold text-ink">Источники</h2>
                    <span className="text-xs font-sans text-ink-tertiary">
                      {evidence.region_names.join(', ')} · по состоянию на{' '}
                      {new Date(evidence.created_at).toLocaleDateString('ru-RU')}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                      <Icon name="bar-chart" size={12} />
                      Вакансии
                    </div>
                    <div className="space-y-4">
                      {evidence.vacancy_snapshot.map((region) => (
                        <div key={region.region_code}>
                          {evidence.vacancy_snapshot.length > 1 && (
                            <div className="text-xs font-sans font-semibold text-ink mb-1.5">{region.region_name}</div>
                          )}
                          <div className="space-y-3">
                            {region.by_profession.map((p) => (
                              <div key={p.term}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-sm font-sans font-medium text-ink">«{p.term}»</span>
                                  <span className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">
                                    {p.total.toLocaleString('ru-RU')} вакансий
                                  </span>
                                </div>
                                {p.sample.length > 0 && (
                                  <div className="space-y-1">
                                    {p.sample.map((s, i) => (
                                      <div key={i} className="flex items-center gap-2 text-xs font-sans bg-canvas border border-border rounded-md px-2.5 py-1.5">
                                        <a href={s.url} target="_blank" rel="noreferrer"
                                           className="font-medium text-ink hover:text-amber truncate flex-1 min-w-0" title={s.title}>
                                          {s.title}
                                        </a>
                                        <span className="text-ink-secondary truncate max-w-[35%] flex-shrink-0 hidden sm:inline" title={s.employer}>
                                          {s.employer}
                                        </span>
                                        {s.salary && (
                                          <span className="flex-shrink-0 text-[10px] font-sans font-medium bg-success-bg text-success px-1.5 py-0.5 rounded-sm whitespace-nowrap">
                                            {s.salary}
                                          </span>
                                        )}
                                        <span className="flex-shrink-0 text-ink-tertiary tabular-nums whitespace-nowrap">
                                          {s.date}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                      <Icon name="file-check" size={12} />
                      Профстандарты
                    </div>
                    {evidence.profstandard_refs.length === 0 ? (
                      <p className="text-xs font-sans text-ink-tertiary">Не найдено для этого направления в реестре ФГОС.</p>
                    ) : (
                      <div className="space-y-1">
                        {evidence.profstandard_refs.map((r) => (
                          <div key={r.code} className="flex items-start gap-2 text-xs font-sans bg-canvas border border-border rounded-md px-2.5 py-1.5">
                            <span className="flex-shrink-0 font-mono text-[10px] font-medium bg-surface-warm text-ink-tertiary px-1.5 py-0.5 rounded-sm mt-0.5">
                              {r.code}
                            </span>
                            <span className="text-ink">{r.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {evidence.strategy_excerpts.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                        <Icon name="building" size={12} />
                        Стратегия развития университета
                      </div>
                      <div className="space-y-2">
                        {evidence.strategy_excerpts.map((e, i) => (
                          <div key={i} className="text-xs font-sans bg-canvas border border-border rounded-md px-2.5 py-1.5">
                            <p className="text-ink leading-relaxed">«{e.text}»</p>
                            {e.page_start && (
                              <p className="text-ink-tertiary mt-1">
                                стр. {e.page_start}{e.page_end && e.page_end !== e.page_start ? `–${e.page_end}` : ''}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <p className="text-sm font-sans text-ink-secondary py-8 text-center">
                Для этой программы ещё не сгенерировано обоснование.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
