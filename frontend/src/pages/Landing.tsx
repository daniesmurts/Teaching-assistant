import { Navigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function Landing() {
  const token = useAuthStore((s) => s.token)
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')

  if (token) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans">
      {/* Top Navigation */}
      <PublicHeader />

      {/* Hero Section */}
      <section className="max-w-[800px] mx-auto px-6 pt-24 pb-20 text-center">
        <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-6">
          Верните себе выходные.<br/>Доверьте проверку работ ИИ.
        </h1>
        <p className="text-lg text-ink-secondary mb-10 max-w-[600px] mx-auto leading-relaxed">
          ИСПУМ помогает преподавателям проверять студенческие работы с высокой точностью и генерировать структурированные лекции за минуты. Создано для современного академического сообщества.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/register" className="px-6 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">Попробовать бесплатно</Link>
        </div>
        
        {/* Abstract UI Visual (Hero) */}
        <div className="mt-16 mx-auto w-full max-w-[700px] bg-surface rounded-xl border border-border shadow-sm overflow-hidden flex text-left">
          <div className="w-1/2 p-6 bg-surface-warm border-r border-border font-mono text-[11px] leading-relaxed text-ink-secondary flex flex-col justify-center">
            <div className="w-full h-2 bg-border rounded-sm mb-3"></div>
            <div className="w-5/6 h-2 bg-border rounded-sm mb-3"></div>
            <div className="w-full h-2 bg-border rounded-sm mb-3"></div>
            <div className="w-4/6 h-2 bg-border rounded-sm mb-8"></div>
            <div className="w-full h-2 bg-border rounded-sm mb-3"></div>
            <div className="w-1/2 h-2 bg-border rounded-sm"></div>
          </div>
          <div className="w-1/2 p-6 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-6">
              <div className="font-display text-4xl font-bold text-success leading-none">5-</div>
              <div>
                <div className="text-xs font-semibold text-success uppercase tracking-wide">Одобрено</div>
                <div className="text-xs text-ink-tertiary mt-0.5">ИСПУМ AI</div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1.5"><span className="font-medium">Аргументация</span><span className="text-ink-secondary">5/5</span></div>
                <div className="h-1 bg-border rounded-full overflow-hidden"><div className="h-full bg-success w-[100%]"></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5"><span className="font-medium">Стиль</span><span className="text-ink-secondary">4/5</span></div>
                <div className="h-1 bg-border rounded-full overflow-hidden"><div className="h-full bg-amber w-[80%]"></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem & Solution (Editorial Block) */}
      <section className="max-w-[700px] mx-auto px-6 py-20 border-t border-border">
        <h2 className="font-display text-2xl font-bold mb-4">Академическое выгорание — это реальность</h2>
        <div className="prose prose-sm text-ink-secondary leading-relaxed space-y-4">
          <p>
            Преподаватели тратят десятки часов еженедельно на проверку эссе, отчетов и курсовых работ. Это время отнимается от исследовательской работы, подготовки к лекциям и, самое главное, отдыха.
          </p>
          <p>
            ИСПУМ сокращает время первичной проверки на 80%. Вы задаете критерии оценки, а наш специализированный ИИ анализирует текст, выявляет сильные и слабые стороны, и предлагает развернутый отзыв. Вам остается только просмотреть, при необходимости скорректировать и утвердить результат.
          </p>
        </div>
      </section>

      {/* Feature Showcase */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6 space-y-24">
          
          {/* Feature 1 */}
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-amber uppercase tracking-wider">Интеллектуальная проверка</div>
              <h3 className="font-display text-3xl font-bold">Обучается на ваших оценках</h3>
              <p className="text-ink-secondary leading-relaxed">
                ИСПУМ не использует шаблонные ответы. Как только вы утверждаете оценку, система запоминает ваш стиль и требования. С каждой проверенной работой (благодаря технологии RAG) рекомендации ИИ становятся всё более точными и персонализированными.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm">
              <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-4">История утверждений</div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border-mid bg-bg">
                    <div className="w-8 h-8 rounded-full bg-success-bg flex items-center justify-center text-success font-display font-bold text-sm">{i === 1 ? '5' : i === 2 ? '4+' : '5-'}</div>
                    <div className="flex-1">
                      <div className="h-2 w-1/2 bg-border rounded-sm mb-1.5"></div>
                      <div className="h-2 w-1/3 bg-border rounded-sm"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-info uppercase tracking-wider">Генератор лекций</div>
              <h3 className="font-display text-3xl font-bold">От силлабуса до слайдов</h3>
              <p className="text-ink-secondary leading-relaxed">
                Загрузите рабочую программу или план курса, укажите тему и аудиторию. ИСПУМ сгенерирует структурированный план презентации со смысловыми блоками и заметками для спикера, готовый к переносу в PowerPoint.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm flex text-sm">
              <div className="w-1/3 pr-4 border-r border-border text-ink-tertiary font-mono text-[10px] space-y-2">
                <div className="uppercase mb-2 font-sans font-bold text-ink-secondary">Силлабус</div>
                <div>Цели курса...</div>
                <div className="h-1 bg-border rounded-full w-full"></div>
                <div className="h-1 bg-border rounded-full w-4/5"></div>
              </div>
              <div className="w-2/3 pl-4">
                <div className="uppercase mb-2 font-sans font-bold text-ink-secondary text-[10px]">Слайд 1</div>
                <div className="font-display font-bold text-lg mb-2">Введение в микроэкономику</div>
                <ul className="space-y-1 mb-4 text-xs text-ink-secondary list-disc pl-4">
                  <li>Базовые принципы</li>
                  <li>Спрос и предложение</li>
                </ul>
                <div className="bg-surface-warm p-2 rounded text-[11px] text-ink-secondary border border-border">
                  <span className="font-semibold">Заметки спикера:</span> Начните с примера о стоимости кофе в кампусе...
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-[1000px] mx-auto px-6 py-24 text-center">
        <h2 className="font-display text-3xl font-bold mb-12">Как это работает</h2>
        <div className="grid md:grid-cols-3 gap-8 text-left">
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-light text-amber flex items-center justify-center font-bold text-lg mb-4">1</div>
            <h4 className="font-bold text-lg">Настройте параметры</h4>
            <p className="text-sm text-ink-secondary leading-relaxed">Загрузите свою рубрику (критерии оценки) или силлабус курса. Система адаптируется под ваши требования.</p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-light text-amber flex items-center justify-center font-bold text-lg mb-4">2</div>
            <h4 className="font-bold text-lg">Доверьте рутину ИИ</h4>
            <p className="text-sm text-ink-secondary leading-relaxed">Алгоритмы DeepSeek анализируют текст и формируют подробный черновик отзыва или структуры лекции.</p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-light text-amber flex items-center justify-center font-bold text-lg mb-4">3</div>
            <h4 className="font-bold text-lg">Проверьте и утвердите</h4>
            <p className="text-sm text-ink-secondary leading-relaxed">Вы всегда контролируете результат. Отредактируйте сгенерированный контент и утвердите его.</p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6">
          <h2 className="font-display text-3xl font-bold text-center mb-8">Тарифы</h2>
          
          <div className="flex justify-center mb-12">
            <div className="bg-bg p-1 rounded-lg border border-border inline-flex text-sm font-medium">
              <button 
                onClick={() => setBilling('monthly')}
                className={`px-6 py-2 rounded-md transition-colors ${billing === 'monthly' ? 'bg-surface shadow-sm text-ink' : 'text-ink-secondary hover:text-ink'}`}
              >
                Ежемесячно
              </button>
              <button 
                onClick={() => setBilling('annual')}
                className={`px-6 py-2 rounded-md transition-colors ${billing === 'annual' ? 'bg-surface shadow-sm text-ink' : 'text-ink-secondary hover:text-ink'}`}
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
              <Link to="/register" className="w-full block text-center px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-medium hover:bg-surface-warm transition-colors">Связаться</Link>
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
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Проверок в месяц</td>
                  <td className="py-3 px-4">20</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Презентаций в месяц</td>
                  <td className="py-3 px-4">3</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Активных курсов</td>
                  <td className="py-3 px-4">3</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Рубрик</td>
                  <td className="py-3 px-4">5</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Загрузка документов</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Обучение ИИ (RAG)</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Генерация писем</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">История проверок</td>
                  <td className="py-3 px-4">30 дней</td>
                  <td className="py-3 px-4">Полная</td>
                  <td className="py-3 px-4">Полная</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">История презентаций</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Общие рубрики института</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Панель администратора</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Приглашение преподавателей</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Отчеты об использовании</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4">Личные</td>
                  <td className="py-3 px-4">Общие по институту</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Водяной знак</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Поддержка</td>
                  <td className="py-3 px-4">Сообщество</td>
                  <td className="py-3 px-4">Приоритетная (Email)</td>
                  <td className="py-3 px-4">Выделенная + онбординг</td>
                </tr>
                <tr className="hover:bg-surface transition-colors">
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

      <PublicFooter />
    </div>
  )
}
