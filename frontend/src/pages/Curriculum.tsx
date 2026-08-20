import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import { analyzeOverlap } from '../api/curriculum'
import CurriculumConformance from './CurriculumConformance'
import CurriculumStudio from './CurriculumStudio'
import OverlapReport from '../components/curriculum/OverlapReport'
import { useUIStore } from '../store/uiStore'
import { useSessionStorageState } from '../hooks/useSessionStorageState'
import type { CurriculumAnalysis } from '../types'

type Tab = 'overlap' | 'conformance' | 'studio'

export default function Curriculum() {
  // Deep-linkable tab (?tab=studio) — the programme detail page's «Открыть в
  // РПД-студии» bridge lands here with the студия preselected.
  const [searchParams] = useSearchParams()
  const paramTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    paramTab === 'studio' || paramTab === 'conformance' || paramTab === 'overlap' ? paramTab : 'overlap'
  )

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Учебный план и РПД"
        subtitle="Анализ качества и подготовка содержания"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[960px] mx-auto page-enter">
          {/* Tabs — the «РПД suite» grouped under one menu item (no extra nav) */}
          <div className="flex gap-1 mb-6 border-b border-border">
            <TabButton active={tab === 'overlap'} onClick={() => setTab('overlap')}>
              Дублирование тем
            </TabButton>
            <TabButton active={tab === 'conformance'} onClick={() => setTab('conformance')}>
              Соответствие РПД компетенциям
            </TabButton>
            <TabButton active={tab === 'studio'} onClick={() => setTab('studio')}>
              РПД-студия
            </TabButton>
          </div>

          {/* All three tabs stay mounted so switching between them doesn't
              discard an in-progress or completed analysis — only visibility
              toggles. sessionStorage (below / in each tab) covers refresh. */}
          <div className={tab === 'overlap' ? '' : 'hidden'}><OverlapTab /></div>
          <div className={tab === 'conformance' ? '' : 'hidden'}><CurriculumConformance /></div>
          <div className={tab === 'studio' ? '' : 'hidden'}><CurriculumStudio /></div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 -mb-px text-sm font-sans font-medium border-b-2 transition-colors ${
        active ? 'border-amber text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function OverlapTab() {
  const addToast = useUIStore((s) => s.addToast)

  const [selected, setSelected] = useSessionStorageState<string[]>('curriculum:overlap:selected', [])
  const [result, setResult]     = useSessionStorageState<CurriculumAnalysis | null>('curriculum:overlap:result', null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const analyzeMut = useMutation({
    mutationFn: () => analyzeOverlap(selected),
    onSuccess: (data) => setResult(data),
    onError: () => { /* toast handled by the axios interceptor */ },
  })

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function run() {
    if (selected.length < 2) {
      addToast('Выберите минимум две дисциплины', 'error')
      return
    }
    setResult(null)
    analyzeMut.mutate()
  }

  return (
    <>
      <FeatureIntro
        id="curriculum-overlap"
        title="Как это работает"
        description="Выберите дисциплины одного учебного плана — система выделит изучаемые темы каждой дисциплины, сравнит их между собой и покажет, где содержание дублируется для одного студента."
        steps={[
          'Отметьте 2 и более дисциплины (нужна программа или загруженный РПД у каждой)',
          'Система выделяет темы и сравнивает их семантически между дисциплинами',
          'Вы видите пары пересекающихся тем с типом пересечения и рекомендацией',
        ]}
      />

      {/* Discipline picker */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-sans font-medium text-ink">Дисциплины учебного плана</span>
          <span className="text-xs font-sans text-ink-tertiary">
            Выбрано: {selected.length}
          </span>
        </div>

        {courses.length === 0 ? (
          <div className="p-4 text-sm font-sans text-ink-secondary">
            Сначала добавьте дисциплины в разделе «Предметы».
          </div>
        ) : (
          <div className="p-2">
            {courses.map((c) => {
              const checked = selected.includes(c.id)
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                    checked ? 'bg-amber-light/50' : 'hover:bg-surface-warm'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                    className="accent-amber w-4 h-4"
                  />
                  <span className="flex-1 text-sm font-sans text-ink">{c.name}</span>
                  {c.code && <span className="text-xs font-sans text-ink-tertiary">{c.code}</span>}
                </label>
              )
            })}
          </div>
        )}

        <div className="px-4 py-3 border-t border-border flex items-center gap-3">
          <Button onClick={run} loading={analyzeMut.isPending} disabled={selected.length < 2}>
            Найти дублирование
          </Button>
          <span className="text-xs font-sans text-ink-tertiary">
            Анализ может занять 1–2 минуты
          </span>
        </div>
      </div>

      {analyzeMut.isPending && (
        <div className="text-center py-12 text-sm font-sans text-ink-secondary">
          Выделяем темы и сравниваем дисциплины…
        </div>
      )}

      {result && !analyzeMut.isPending && <OverlapReport result={result} />}
    </>
  )
}
