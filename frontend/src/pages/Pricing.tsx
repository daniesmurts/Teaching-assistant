import { useState } from 'react'
import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function Pricing() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">
        {/* Header Section */}
        <section className="max-w-[800px] mx-auto px-6 pt-16 md:pt-24 pb-12 text-center">
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-6">
            Инвестируйте в свое время
          </h1>
          <p className="text-lg text-ink-secondary leading-relaxed max-w-[600px] mx-auto">
            Простые и прозрачные тарифы для преподавателей, репетиторов и учебных заведений.
          </p>
        </section>

        {/* Pricing */}
        <section className="pb-24">
          <div className="max-w-[1000px] mx-auto px-6">
            
            <div className="flex justify-center mb-12">
              <div className="bg-surface-warm p-1 rounded-lg border border-border inline-flex text-sm font-medium">
                <button 
                  onClick={() => setBilling('monthly')}
                  className={`px-6 py-2 rounded-md transition-colors ${billing === 'monthly' ? 'bg-bg shadow-sm text-ink' : 'text-ink-secondary hover:text-ink'}`}
                >
                  Ежемесячно
                </button>
                <button 
                  onClick={() => setBilling('annual')}
                  className={`px-6 py-2 rounded-md transition-colors ${billing === 'annual' ? 'bg-bg shadow-sm text-ink' : 'text-ink-secondary hover:text-ink'}`}
                >
                  Ежегодно <span className="text-success text-xs ml-1">-33%</span>
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mb-20">
              
              {/* Free */}
              <div className="bg-surface border border-border rounded-xl p-6 shadow-sm flex flex-col">
                <h4 className="font-bold mb-1 text-lg">Базовый</h4>
                <div className="text-sm text-ink-secondary mb-4">Для ознакомления</div>
                <div className="font-display text-3xl font-bold mb-6">Бесплатно</div>
                <ul className="space-y-3 mb-8 text-sm text-ink-secondary flex-1">
                  <li className="flex gap-2"><span>•</span> До 20 проверок в месяц</li>
                  <li className="flex gap-2"><span>•</span> До 3 презентаций в месяц</li>
                  <li className="flex gap-2"><span>•</span> До 3 курсов и 5 рубрик</li>
                  <li className="flex gap-2"><span>•</span> Водяной знак на результатах</li>
                </ul>
                <Link to="/register" className="w-full block text-center px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-medium hover:bg-surface-warm transition-colors">Начать бесплатно</Link>
              </div>

              {/* Pro */}
              <div className="bg-surface border-2 border-amber rounded-xl p-6 shadow-md relative flex flex-col transform md:-translate-y-2">
                <div className="absolute top-0 right-6 -translate-y-1/2 bg-amber text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm">Популярный</div>
                <h4 className="font-bold mb-1 text-lg">Профессионал</h4>
                <div className="text-sm text-ink-secondary mb-4">Для преподавателей</div>
                
                <div className="mb-6 h-[60px]">
                  {billing === 'monthly' ? (
                    <div className="font-display text-3xl font-bold">₽990<span className="text-sm font-sans font-normal text-ink-secondary"> /мес</span></div>
                  ) : (
                    <>
                      <div className="font-display text-3xl font-bold">₽7,900<span className="text-sm font-sans font-normal text-ink-secondary"> /год</span></div>
                      <div className="text-xs text-success mt-1 font-medium">Экономия ₽3,980 в год</div>
                    </>
                  )}
                </div>

                <ul className="space-y-3 mb-8 text-sm text-ink-secondary flex-1">
                  <li className="flex gap-2 text-ink"><span>•</span> <b>Безлимитные</b> проверки и презентации</li>
                  <li className="flex gap-2 text-ink"><span>•</span> Загрузка документов</li>
                  <li className="flex gap-2 text-ink"><span>•</span> Обучение ИИ (RAG)</li>
                  <li className="flex gap-2 text-ink"><span>•</span> Генерация писем с отзывами</li>
                  <li className="flex gap-2 text-ink"><span>•</span> Полная история и приоритетная поддержка</li>
                </ul>
                <Link to="/register" className="w-full block text-center px-4 py-2 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">Выбрать Pro</Link>
              </div>

              {/* Institution */}
              <div className="bg-surface border border-border rounded-xl p-6 shadow-sm flex flex-col">
                <h4 className="font-bold mb-1 text-lg">Институт</h4>
                <div className="text-sm text-ink-secondary mb-4">Для кафедр и ВУЗов</div>
                
                <div className="mb-6 h-[60px]">
                  <div className="font-display text-3xl font-bold">₽600<span className="text-sm font-sans font-normal text-ink-secondary"> /место/мес</span></div>
                  <div className="text-xs text-ink-secondary mt-1">От 5 мест (₽3,000/мес). Оплата за год.</div>
                </div>

                <ul className="space-y-3 mb-8 text-sm text-ink-secondary flex-1">
                  <li className="flex gap-2"><span>•</span> Всё из тарифа Профессионал</li>
                  <li className="flex gap-2"><span>•</span> Панель администратора и статистика</li>
                  <li className="flex gap-2"><span>•</span> Общие рубрики кафедры</li>
                  <li className="flex gap-2"><span>•</span> Приглашение преподавателей</li>
                  <li className="flex gap-2"><span>•</span> Выделенная поддержка и онбординг</li>
                </ul>
                <Link to="/institutions" className="w-full block text-center px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-medium hover:bg-surface-warm transition-colors">Связаться</Link>
              </div>

            </div>

            {/* Feature Matrix Table */}
            <div className="mt-12 overflow-x-auto pb-4">
              <h3 className="font-display text-2xl font-bold mb-6 text-center">Сравнение функций</h3>
              <table className="w-full min-w-[700px] text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="py-4 px-4 font-bold text-ink">Функция</th>
                    <th className="py-4 px-4 font-bold text-ink">Базовый</th>
                    <th className="py-4 px-4 font-bold text-ink text-amber">Профессионал</th>
                    <th className="py-4 px-4 font-bold text-ink">Институт</th>
                  </tr>
                </thead>
                <tbody className="text-ink-secondary">
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Проверок в месяц</td>
                    <td className="py-3 px-4">20</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Презентаций в месяц</td>
                    <td className="py-3 px-4">3</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Активных курсов</td>
                    <td className="py-3 px-4">3</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Рубрик</td>
                    <td className="py-3 px-4">5</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                    <td className="py-3 px-4 text-ink">Безлимитно</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Загрузка документов</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Обучение ИИ (RAG)</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Генерация писем</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">История проверок</td>
                    <td className="py-3 px-4">30 дней</td>
                    <td className="py-3 px-4">Полная</td>
                    <td className="py-3 px-4">Полная</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">История презентаций</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Общие рубрики института</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Панель администратора</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Приглашение преподавателей</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-success">✓</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Отчеты об использовании</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4">Личные</td>
                    <td className="py-3 px-4">Общие по институту</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Водяной знак</td>
                    <td className="py-3 px-4 text-success">✓</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                    <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Поддержка</td>
                    <td className="py-3 px-4">Сообщество</td>
                    <td className="py-3 px-4">Приоритетная (Email)</td>
                    <td className="py-3 px-4">Выделенная + онбординг</td>
                  </tr>
                  <tr className="hover:bg-surface-warm transition-colors">
                    <td className="py-3 px-4">Биллинг</td>
                    <td className="py-3 px-4">Бесплатно</td>
                    <td className="py-3 px-4">Месяц / Год</td>
                    <td className="py-3 px-4">Годовой счет</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
