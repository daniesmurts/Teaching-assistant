import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function About() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans">
      <PublicHeader />

      {/* Hero & Mission Statement */}
      <section className="max-w-[800px] mx-auto px-6 pt-24 pb-20 text-center">
        <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8">
          Технологии должны помогать преподавателям, а не заменять их.
        </h1>
        <p className="text-lg text-ink-secondary mb-10 leading-relaxed max-w-[600px] mx-auto">
          GradeAssist был создан, чтобы решить самую болезненную проблему академической среды — бесконечные часы, уходящие на проверку работ. Мы создали инструмент, который уважает вашу экспертизу и возвращает вам время для исследований, лекций и личной жизни.
        </p>
        <Link to="/register" className="inline-block px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
          Начать использовать бесплатно
        </Link>
      </section>

      {/* Feature Block 1: Smart Grading Engine */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
              <div className="text-xs font-bold text-amber uppercase tracking-wider">Интеллектуальная проверка</div>
              <h2 className="font-display text-3xl font-bold">Обучается на ваших оценках</h2>
              <p className="text-ink-secondary leading-relaxed">
                Система обучается на ваших оценках. Чем больше вы проверяете, тем точнее становятся рекомендации. GradeAssist не просто использует шаблоны — наша технология RAG (Retrieval-Augmented Generation) анализирует ваши предыдущие вердикты и подстраивается под ваш уникальный стиль преподавания и требования к студентам.
              </p>
              <Link to="/register" className="inline-block px-6 py-2 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface transition-colors mt-2">
                Проверить первую работу
              </Link>
            </div>
            
            {/* Visual */}
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-8 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-full max-w-[300px] space-y-4">
                <div className="flex items-center gap-3 opacity-50">
                  <div className="w-8 h-8 rounded border border-border-mid flex items-center justify-center text-xs">1</div>
                  <div className="flex-1 h-2 bg-border-mid rounded-sm"></div>
                </div>
                <div className="flex items-center gap-3 opacity-75">
                  <div className="w-8 h-8 rounded border border-border-mid flex items-center justify-center text-xs">2</div>
                  <div className="flex-1 h-2 bg-border-mid rounded-sm"></div>
                </div>
                <div className="flex items-center gap-3 bg-amber-light/20 p-3 rounded-lg border border-amber/30">
                  <div className="w-8 h-8 rounded bg-amber text-white flex items-center justify-center text-xs font-bold">3</div>
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2 w-full bg-amber/50 rounded-sm"></div>
                    <div className="h-2 w-4/5 bg-amber/50 rounded-sm"></div>
                  </div>
                </div>
                <div className="text-center text-xs text-ink-tertiary mt-2">Синхронизация паттернов...</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Block 1.5: Student Progress */}
      <section className="py-24">
        <div className="max-w-[1000px] mx-auto px-6">
          <div className="flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-6">
              <div className="text-xs font-bold text-success uppercase tracking-wider">Аналитика успеваемости</div>
              <h2 className="font-display text-3xl font-bold">История прогресса студентов</h2>
              <p className="text-ink-secondary leading-relaxed">
                Принимайте взвешенные решения на основе данных. Система сохраняет историю оценок каждого студента, позволяя отслеживать динамику его успеваемости на протяжении всего семестра. Это помогает выявлять пробелы в знаниях и оказывать своевременную поддержку.
              </p>
              <Link to="/register" className="inline-block px-6 py-2 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface transition-colors mt-2">
                Смотреть аналитику
              </Link>
            </div>
            
            {/* Visual */}
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-8 shadow-sm flex flex-col justify-center min-h-[300px]">
              <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-6">Иванов Иван — Динамика (Семестр)</div>
              <div className="flex items-end gap-3 h-32 border-b border-border-mid pb-2">
                <div className="w-1/4 bg-amber/40 hover:bg-amber/60 transition-colors rounded-t-sm h-[40%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">3</div>
                </div>
                <div className="w-1/4 bg-amber hover:bg-amber/80 transition-colors rounded-t-sm h-[60%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">4-</div>
                </div>
                <div className="w-1/4 bg-success/70 hover:bg-success transition-colors rounded-t-sm h-[80%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">4+</div>
                </div>
                <div className="w-1/4 bg-success hover:bg-success/90 transition-colors rounded-t-sm h-[100%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">5</div>
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-ink-tertiary mt-2">
                <span>Эссе 1</span>
                <span>Тест</span>
                <span>Курсовая</span>
                <span>Экзамен</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Block 2: Lecture Generator */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
              <div className="text-xs font-bold text-info uppercase tracking-wider">Ваш личный ассистент</div>
              <h2 className="font-display text-3xl font-bold">От силлабуса до слайдов за 30 секунд</h2>
              <p className="text-ink-secondary leading-relaxed">
                Тратьте время на подачу материала, а не на форматирование слайдов. Просто загрузите план вашей лекции, и система автоматически разобьет его на логические блоки, сгенерирует тезисы для студентов и подробные заметки для спикера.
              </p>
              <Link to="/register" className="inline-block px-6 py-2 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface-warm transition-colors mt-2">
                Сгенерировать лекцию
              </Link>
            </div>
            
            {/* Visual */}
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-8 shadow-sm flex">
              <div className="w-1/2 pr-6 border-r border-border text-ink-tertiary">
                <div className="text-[10px] uppercase tracking-wider mb-4 font-bold text-ink-secondary">План (Ввод)</div>
                <div className="space-y-2">
                  <div className="h-1.5 w-full bg-border rounded-full"></div>
                  <div className="h-1.5 w-5/6 bg-border rounded-full"></div>
                  <div className="h-1.5 w-full bg-border rounded-full"></div>
                  <div className="h-1.5 w-4/6 bg-border rounded-full"></div>
                  <div className="h-1.5 w-full bg-border rounded-full"></div>
                </div>
              </div>
              <div className="w-1/2 pl-6">
                <div className="text-[10px] uppercase tracking-wider mb-4 font-bold text-info">Слайды (Вывод)</div>
                <div className="border border-info/30 rounded bg-info/5 p-3 mb-3">
                  <div className="h-2 w-2/3 bg-info/40 rounded-sm mb-2"></div>
                  <div className="h-1.5 w-full bg-info/20 rounded-sm mb-1"></div>
                  <div className="h-1.5 w-4/5 bg-info/20 rounded-sm"></div>
                </div>
                <div className="border border-border-mid rounded bg-bg p-3">
                  <div className="h-2 w-1/2 bg-border rounded-sm mb-2"></div>
                  <div className="h-1.5 w-full bg-border-mid rounded-sm"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Core Values */}
      <section className="py-24 border-b border-border">
        <div className="max-w-[800px] mx-auto px-6 text-center">
          <h2 className="font-display text-3xl font-bold mb-12">Безопасность и Приватность</h2>
          <div className="grid md:grid-cols-2 gap-8 text-left">
            <div className="bg-surface p-6 rounded-xl border border-border">
              <h3 className="font-bold text-lg mb-3">Ваши данные — только ваши</h3>
              <p className="text-sm text-ink-secondary leading-relaxed">
                Мы никогда не используем загруженные вами студенческие работы для тренировки публичных моделей ИИ. Вся информация изолирована в рамках вашего аккаунта или института.
              </p>
            </div>
            <div className="bg-surface p-6 rounded-xl border border-border">
              <h3 className="font-bold text-lg mb-3">Российская инфраструктура</h3>
              <p className="text-sm text-ink-secondary leading-relaxed">
                Система разработана для бесперебойной работы в РФ без использования VPN. Мы соблюдаем местные стандарты защиты данных и конфиденциальности.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final Inspiring CTA */}
      <section className="max-w-[800px] mx-auto px-6 py-24 text-center">
        <h2 className="font-display text-4xl font-bold mb-6">Верните себе 15 часов в неделю.</h2>
        <p className="text-lg text-ink-secondary mb-10 max-w-[500px] mx-auto">
          Присоединяйтесь к преподавателям, которые уже оптимизировали свою рутину с помощью GradeAssist.
        </p>
        <Link to="/register" className="inline-block px-10 py-4 rounded-md bg-amber text-white font-bold text-lg shadow-sm hover:opacity-90 hover:shadow transition-all">
          Зарегистрироваться бесплатно
        </Link>
      </section>

      <PublicFooter />
    </div>
  )
}
