import { Link } from 'react-router-dom'
import TopBar from '../components/layout/TopBar'
import Icon, { type IconName } from '../components/ui/Icon'

// One hub for everything the teacher can generate. Collapses three sidebar items
// (Презентации / Темы / Тесты) into a single «Материалы» entry and gives a
// brand-new user a clear "what can I create?" overview instead of cryptic menu
// items. Cards link to the existing generator pages (routes unchanged). Future
// КНИТУ T1 types (кейсы / проекты / задания) slot in here as more cards.

interface MaterialCard {
  icon:  IconName
  title: string
  desc:  string
  to:    string
}

const CARDS: MaterialCard[] = [
  {
    icon: 'presentation',
    title: 'Презентации',
    desc: 'Структура лекции по теме — заголовки, тезисы и заметки докладчика.',
    to: '/presentations',
  },
  {
    icon: 'quiz',
    title: 'Тесты',
    desc: 'Вопросы с вариантами ответов по теме, с опорой на материалы предмета.',
    to: '/quizzes',
  },
  {
    icon: 'lightbulb',
    title: 'Темы работ',
    desc: 'Темы курсовых, ВКР и практик под уровень и интересы студента.',
    to: '/topics',
  },
  {
    icon: 'list-checks',
    title: 'Практические задания',
    desc: 'Практические задания по теме — с условиями и подсказками для преподавателя.',
    to: '/materials/assignment',
  },
  {
    icon: 'building',
    title: 'Кейсы',
    desc: 'Учебные кейсы (case-study): ситуация и вопросы для разбора.',
    to: '/materials/case',
  },
  {
    icon: 'layers',
    title: 'Проекты',
    desc: 'Проектные задания: цель, ожидаемый результат и этапы работы.',
    to: '/materials/project',
  },
]

export default function Materials() {
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Материалы" subtitle="Что подготовить с помощью ИСПУМ" />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[960px] mx-auto page-enter">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CARDS.map((c) => (
              <Link
                key={c.to}
                to={c.to}
                className="group bg-surface border border-border rounded-lg p-5 hover:border-amber-mid/40 hover:bg-surface-warm transition-colors"
              >
                <div className="w-9 h-9 rounded-md bg-amber-light flex items-center justify-center mb-3">
                  <Icon name={c.icon} className="text-amber" />
                </div>
                <div className="text-sm font-sans font-medium text-ink mb-1">{c.title}</div>
                <div className="text-xs font-sans text-ink-secondary leading-relaxed">{c.desc}</div>
                <div className="mt-3 text-xs font-sans font-medium text-amber opacity-0 group-hover:opacity-100 transition-opacity">
                  Создать →
                </div>
              </Link>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
