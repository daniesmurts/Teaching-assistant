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
        <div className="text-[11px] font-sans font-semibold text-amber uppercase tracking-[0.15em] mb-4">
          ИСПУМ · Интеллектуальная Система Проверки и Подготовки Учебных Материалов
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-6">
          Преподавание без компромиссов.
        </h1>
        <p className="text-lg text-ink-secondary mb-10 max-w-[600px] mx-auto leading-relaxed">
          Больше студентов — без потери качества. Быстрее проверка — без потери глубины. ИСПУМ делает возможным то, на что раньше не хватало времени.
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
            Десятки часов в неделю уходят на проверку студенческих работ — вместо исследований, живых лекций и отдыха. ИСПУМ сокращает это время на 80%: вы задаёте критерии, платформа анализирует и даёт развёрнутый отзыв, вы — просматриваете и утверждаете.
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
                ИСПУМ не даёт шаблонных ответов. Каждая утверждённая оценка — это сигнал: система запоминает ваши стандарты и требования. Чем больше работ вы проверяете, тем точнее ИСПУМ понимает именно ваш стиль.
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
              <h3 className="font-display text-3xl font-bold">Программа загружена. Лекция готова.</h3>
              <p className="text-ink-secondary leading-relaxed">
                Загрузите план предмета, укажите тему и уровень аудитории. ИСПУМ создаст структурированную презентацию с заметками для спикера — готовую к использованию. Обновляется при появлении новых данных. Адаптируется под уровень группы за один клик.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm flex text-sm">
              <div className="w-1/3 pr-4 border-r border-border text-ink-tertiary font-mono text-[10px] space-y-2">
                <div className="uppercase mb-2 font-sans font-bold text-ink-secondary">Силлабус</div>
                <div>Цели предмета...</div>
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

          {/* Feature 3 — Quizzes */}
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-amber uppercase tracking-wider">Тесты и викторины</div>
              <h3 className="font-display text-3xl font-bold">Контрольные за минуту, а не за вечер</h3>
              <p className="text-ink-secondary leading-relaxed">
                Укажите тему, число вопросов и уровень сложности — ИСПУМ соберёт тест с вариантами ответов и пояснениями, опираясь на материалы вашего предмета. Подходит для проверки запоминания, понимания или применения. Готовый тест можно скопировать в LMS или показать прямо на экране.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider">Микроэкономика · 10 вопросов</div>
                <div className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">Понимание</div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium mb-2">3. Что произойдёт со спросом при росте дохода потребителей?</div>
                  <div className="space-y-1.5">
                    {[
                      { label: 'A', text: 'Кривая спроса сместится влево', correct: false },
                      { label: 'B', text: 'Кривая спроса сместится вправо',  correct: true },
                      { label: 'C', text: 'Изменится только наклон кривой',  correct: false },
                    ].map((o) => (
                      <div
                        key={o.label}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs ${
                          o.correct
                            ? 'bg-success-bg border-success/25 text-success'
                            : 'bg-bg border-border text-ink-secondary'
                        }`}
                      >
                        <span className="font-display font-bold text-[11px] w-4">{o.label}</span>
                        <span className="flex-1">{o.text}</span>
                        {o.correct && <span className="text-success font-bold">✓</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-surface-warm p-2.5 rounded text-[11px] text-ink-secondary border border-border leading-relaxed">
                  <span className="font-semibold">Пояснение:</span> Рост дохода — это сдвиг кривой спроса, а не движение по ней. См. лекция 2, нормальные блага.
                </div>
              </div>
            </div>
          </div>

          {/* Feature 3.5 — Live QR quiz */}
          <div className="flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-warning uppercase tracking-wider">Живой тест в аудитории</div>
              <h3 className="font-display text-3xl font-bold">Один клик — и весь поток отвечает со своих устройств</h3>
              <p className="text-ink-secondary leading-relaxed">
                Запустите любой сгенерированный тест прямо на паре: чистый экран для проектора с QR-кодом и живой гистограммой ответов, студенты подключаются со смартфона, планшета или ноутбука по ссылке — без регистрации. Выберите темп — в общем ритме под ваш показ или у каждого свой. По итогам сохраните результаты в журнал одним кликом — оценки сразу попадают в успеваемость и траекторию студента.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider">Экран проектора · Вопрос 3 из 10</div>
                <div className="flex items-center gap-1.5 text-[10px] font-sans font-medium bg-warning-bg text-warning px-1.5 py-0.5 rounded-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse"></span> LIVE
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border-mid bg-bg mb-4">
                <div className="w-10 h-10 rounded-md bg-ink flex-shrink-0" style={{
                  backgroundImage: 'repeating-conic-gradient(rgb(var(--color-bg-rgb)) 0% 25%, rgb(var(--color-ink-rgb)) 0% 50%)',
                  backgroundSize: '5px 5px',
                }}></div>
                <div className="flex-1">
                  <div className="text-xs font-sans font-medium text-ink">Код подключения: <span className="font-display font-bold">7F3K9</span></div>
                  <div className="text-[10px] font-sans text-ink-tertiary mt-0.5">27 студентов подключено</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'A', pct: 62, correct: true },
                  { label: 'B', pct: 23, correct: false },
                  { label: 'C', pct: 10, correct: false },
                  { label: 'D', pct: 5,  correct: false },
                ].map((o) => (
                  <div key={o.label} className="flex items-center gap-2 text-xs">
                    <span className="font-display font-bold w-4 text-ink-secondary">{o.label}</span>
                    <div className="flex-1 h-5 bg-bg rounded-sm overflow-hidden border border-border-mid">
                      <div
                        className={`h-full ${o.correct ? 'bg-success' : 'bg-border-strong'}`}
                        style={{ width: `${o.pct}%`, opacity: 0.85 }}
                      ></div>
                    </div>
                    <span className="w-8 text-right text-ink-tertiary">{o.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature 4 — Analytics */}
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-success uppercase tracking-wider">Аналитика успеваемости</div>
              <h3 className="font-display text-3xl font-bold">Видно, кто растёт, а кому нужна помощь</h3>
              <p className="text-ink-secondary leading-relaxed">
                Успеваемость собирается автоматически из проверенных работ: профиль каждого студента, динамика оценок по времени и средний балл по группе. Вы видите картину всего потока — и вовремя поддерживаете тех, кто отстаёт.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider">Динамика оценок</div>
                <div className="text-xs text-ink-tertiary">средний балл <span className="font-display font-bold text-ink text-sm">4.3</span></div>
              </div>
              <div className="flex gap-2 h-28 border-b border-border-mid pb-1">
                {[
                  { h: 50, c: 'bg-warning', g: 'C' },
                  { h: 62, c: 'bg-amber',   g: 'B' },
                  { h: 58, c: 'bg-amber',   g: 'B' },
                  { h: 80, c: 'bg-success', g: 'A' },
                  { h: 92, c: 'bg-success', g: 'A' },
                ].map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end">
                    <span className="text-[10px] font-display font-bold text-ink-secondary mb-1">{b.g}</span>
                    <div className={`w-full max-w-[34px] rounded-t-sm ${b.c}`} style={{ height: `${b.h}%`, opacity: 0.85 }}></div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                {['окт', 'ноя', 'дек', 'фев', 'апр'].map((m) => (
                  <div key={m} className="flex-1 text-center text-[9px] text-ink-tertiary">{m}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature 5 — LTI / Moodle integration */}
          <div className="flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-4">
              <div className="text-xs font-bold text-amber uppercase tracking-wider">Интеграция с Moodle</div>
              <h3 className="font-display text-3xl font-bold">Прямо из курса — без отдельного входа</h3>
              <p className="text-ink-secondary leading-relaxed">
                Подключите ИСПУМ к Moodle по стандарту LTI 1.3. Преподаватель открывает задание в своём курсе и сразу оказывается в ИСПУМ авторизованным. Студент сдаёт работу без регистрации. Утверждённая оценка автоматически возвращается в журнал Moodle — никакого ручного экспорта.
              </p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-6 shadow-sm">
              <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Курс в Moodle</div>
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border-mid bg-bg mb-4">
                <div className="w-8 h-8 rounded-md bg-info-bg flex items-center justify-center text-info font-display font-bold text-xs flex-shrink-0">М</div>
                <div className="flex-1 min-w-0">
                  <div className="h-2 w-2/3 bg-border rounded-sm mb-1.5"></div>
                  <div className="h-2 w-1/3 bg-border rounded-sm"></div>
                </div>
                <span className="text-[10px] font-sans font-medium bg-amber text-white px-2 py-1 rounded-sm flex-shrink-0">Открыть в ИСПУМ →</span>
              </div>
              <div className="flex justify-center text-ink-tertiary mb-4">↓</div>
              <div className="flex items-center gap-3 p-3 rounded-lg border border-amber/30 bg-amber-light/30">
                <div className="w-8 h-8 rounded-full bg-success-bg flex items-center justify-center text-success font-bold text-sm flex-shrink-0">✓</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-sans font-medium text-ink">Авторизован в ИСПУМ</div>
                  <div className="text-[10px] font-sans text-ink-tertiary">Оценка передана в журнал Moodle</div>
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
            <p className="text-sm text-ink-secondary leading-relaxed">Загрузите свою рубрику (критерии оценки) или силлабус предмета. Система адаптируется под ваши требования.</p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-light text-amber flex items-center justify-center font-bold text-lg mb-4">2</div>
            <h4 className="font-bold text-lg">Доверьте рутину ИСПУМ</h4>
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
                <li className="flex gap-2"><span>•</span> До 20 проверок работ в месяц</li>
                <li className="flex gap-2"><span>•</span> До 3 презентаций в месяц</li>
                <li className="flex gap-2"><span>•</span> До 3 генераций тем для исследований</li>
                <li className="flex gap-2"><span>•</span> До 3 тестов (викторин) в месяц</li>
                <li className="flex gap-2"><span>•</span> До 3 предметов и 5 рубрик</li>
                <li className="flex gap-2"><span>•</span> 30 дней истории проверок</li>
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
                <li className="flex gap-2 text-ink"><span>•</span> <b>Безлимитно:</b> проверки, презентации, темы, тесты</li>
                <li className="flex gap-2 text-ink"><span>•</span> Рецензирование больших работ (ВКР, диплом)</li>
                <li className="flex gap-2 text-ink"><span>•</span> Расчётные задачи: физика, математика, инженерия</li>
                <li className="flex gap-2 text-ink"><span>•</span> Загрузка документов (PDF, Word, OCR)</li>
                <li className="flex gap-2 text-ink"><span>•</span> ИСПУМ обучается на ваших оценках (RAG)</li>
                <li className="flex gap-2 text-ink"><span>•</span> Журнал проверок и экспорт в Moodle (CSV)</li>
                <li className="flex gap-2 text-ink"><span>•</span> Письма с отзывами для студентов</li>
                <li className="flex gap-2 text-ink"><span>•</span> Без водяных знаков, приоритетная поддержка</li>
              </ul>
              <Link to="/register" className="w-full block text-center px-4 py-2 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">Выбрать Pro</Link>
            </div>

            {/* Institution */}
            <div className="bg-surface border border-border rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold mb-1 text-lg">Институт</h4>
              <div className="text-sm text-ink-secondary mb-4">Для кафедр и ВУЗов</div>

              <div className="mb-6 h-[60px]">
                <div className="font-display text-3xl font-bold">Индивидуально</div>
                <div className="text-xs text-ink-secondary mt-1">Расчёт по запросу · годовой контракт</div>
              </div>

              <ul className="space-y-3 mb-8 text-sm text-ink-secondary flex-1">
                <li className="flex gap-2"><span>•</span> Всё из Pro для каждого преподавателя</li>
                <li className="flex gap-2"><span>•</span> Панель администратора и журнал действий</li>
                <li className="flex gap-2"><span>•</span> Массовое приглашение преподавателей</li>
                <li className="flex gap-2"><span>•</span> Авто-вход по корпоративному домену</li>
                <li className="flex gap-2"><span>•</span> Интеграция с Moodle (LTI 1.3) — вход и передача оценок без ручного экспорта</li>
                <li className="flex gap-2"><span>•</span> Общие рубрики кафедры</li>
                <li className="flex gap-2"><span>•</span> Отчёты по использованию (CSV)</li>
                <li className="flex gap-2"><span>•</span> Выделенная поддержка и онбординг</li>
              </ul>
              <Link to="/contact" className="w-full block text-center px-4 py-2 rounded-md border border-border-mid bg-transparent text-ink-secondary font-medium hover:bg-surface-warm transition-colors">Связаться с нами</Link>
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
                  <td className="py-3 px-4">Генераций тем в месяц</td>
                  <td className="py-3 px-4">3</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Тестов (викторин) в месяц</td>
                  <td className="py-3 px-4">3</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                  <td className="py-3 px-4 text-ink">Безлимитно</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Активных предметов</td>
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
                  <td className="py-3 px-4">Загрузка документов (PDF, Word, OCR)</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Рецензирование больших работ (ВКР, диплом)</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Расчётные задачи (физика, математика, инженерия)</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Обучение ИСПУМ на ваших оценках (RAG)</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Генерация писем студентам</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Экспорт оценок в Moodle (CSV)</td>
                  <td className="py-3 px-4 text-success">✓</td>
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
                  <td className="py-3 px-4">Массовое приглашение преподавателей</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Авто-вход по корпоративному домену</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Интеграция с Moodle (LTI 1.3) — вход и оценки без CSV</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Журнал действий (аудит)</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-ink-tertiary">✕</td>
                  <td className="py-3 px-4 text-success">✓</td>
                </tr>
                <tr className="border-b border-border hover:bg-surface transition-colors">
                  <td className="py-3 px-4">Отчёты об использовании (CSV)</td>
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
                  <td className="py-3 px-4">Индивидуально</td>
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
