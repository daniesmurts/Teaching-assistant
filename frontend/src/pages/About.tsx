import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function About() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans">
      <PublicHeader />

      {/* Hero — manifesto statement */}
      <section className="max-w-[820px] mx-auto px-6 pt-24 pb-20 text-center">
        <div className="text-xs font-semibold text-amber uppercase tracking-[0.15em] mb-6">
          О платформе
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8">
          Образование держится на преподавателях. ИСПУМ — на этой простой мысли.
        </h1>
        <p className="text-lg text-ink-secondary leading-relaxed max-w-[640px] mx-auto">
          Профессия преподавателя слишком важна, чтобы её тратили на рутину. Мы делаем инструменты, которые возвращают преподавателю время — и оставляют все ключевые решения за ним.
        </p>
      </section>

      {/* Origin / Why we exist */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[760px] mx-auto px-6">
          <h2 className="font-display text-3xl font-bold mb-8 leading-tight">Зачем мы это делаем</h2>
          <div className="space-y-5 text-ink-secondary leading-relaxed">
            <p>
              Идея ИСПУМ появилась из простого наблюдения: российский преподаватель тратит на рутину — проверку работ, подготовку слайдов, оформление документов — десятки часов в месяц. Время, которое могло бы уйти на исследования, наставничество и на саму преподавательскую работу.
            </p>
            <p>
              При этом готовые инструменты от зарубежных компаний либо не работают в России без VPN, либо не учитывают специфику российского образования: ФГОС, формат рецензирования ВКР, требования аккредитации, привычку к 5-балльной шкале, реальные процессы в кафедрах и деканатах.
            </p>
            <p className="text-ink font-medium">
              ИСПУМ построен в России для российской высшей школы. Не «адаптирован», не «локализован» — а спроектирован с нуля под то, как реально работают наши вузы.
            </p>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="py-24">
        <div className="max-w-[1000px] mx-auto px-6">
          <h2 className="font-display text-3xl font-bold text-center mb-4">Во что мы верим</h2>
          <p className="text-ink-secondary text-center mb-14 max-w-[600px] mx-auto">
            Четыре принципа, которые определяют каждое решение в продукте — от архитектуры до интерфейса.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <Principle
              number="01"
              title="Преподаватель решает. ИИ помогает."
              body="Финальное слово — всегда за человеком. ИСПУМ готовит черновик оценки, разбор, рекомендации — но не выставляет отметку самостоятельно. Преподаватель проверяет, редактирует и утверждает. Если ИИ ошибается — это видно, и это поправимо."
            />
            <Principle
              number="02"
              title="Данные остаются в России."
              body="Все работы, оценки, презентации и материалы хранятся в дата-центрах Яндекс.Облака на территории РФ. Без зарубежных подрядчиков для хранения, без необходимости VPN для доступа из университетских сетей."
            />
            <Principle
              number="03"
              title="Мы не учимся на ваших студентах."
              body="Загруженные работы не используются для тренировки публичных моделей ИИ. Данные изолированы в вашем аккаунте — или, в случае института, в рамках вашей кафедры. Никто, кроме вас, к ним доступа не имеет."
            />
            <Principle
              number="04"
              title="ИСПУМ учится у вас, а не наоборот."
              body="Каждая утверждённая вами оценка делает рекомендации точнее именно для вашего стиля преподавания. Технология RAG не навязывает «правильный» ответ — она калибруется под ваши стандарты и требования к студентам."
            />
          </div>
        </div>
      </section>

      {/* Analytics — kept visual, rewritten copy */}
      <section className="bg-surface-warm py-24 border-y border-border">
        <div className="max-w-[1000px] mx-auto px-6">
          <div className="flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-5">
              <div className="text-xs font-bold text-success uppercase tracking-wider">Что значит «учиться у вас»</div>
              <h2 className="font-display text-3xl font-bold leading-tight">Аналитика помогает преподавателю — не наблюдает за ним.</h2>
              <p className="text-ink-secondary leading-relaxed">
                История оценок каждого студента собирается автоматически и остаётся в руках преподавателя. Это инструмент для того, чтобы вовремя увидеть, кому из ребят нужна поддержка, — а не цифровой надсмотрщик, фиксирующий «эффективность» преподавательской работы для отчёта в деканат.
              </p>
              <p className="text-ink-secondary leading-relaxed">
                Мы намеренно не строили «дашборд для администрации, который следит за каждым преподавателем». Аналитика принадлежит тому, кто ведёт занятия.
              </p>
            </div>

            {/* Visual */}
            <div className="flex-1 w-full bg-surface border border-border rounded-xl p-8 shadow-sm flex flex-col justify-center min-h-[300px]">
              <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-6">Иванов И. И. — Динамика семестра</div>
              <div className="flex items-end gap-3 h-32 border-b border-border-mid pb-2">
                <div className="w-1/4 bg-amber/40 rounded-t-sm h-[40%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">3</div>
                </div>
                <div className="w-1/4 bg-amber rounded-t-sm h-[60%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">4</div>
                </div>
                <div className="w-1/4 bg-success/70 rounded-t-sm h-[80%] relative group">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-ink opacity-0 group-hover:opacity-100 transition-opacity">4</div>
                </div>
                <div className="w-1/4 bg-success rounded-t-sm h-[100%] relative group">
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

      {/* Team — modest founder paragraph */}
      <section className="py-24">
        <div className="max-w-[760px] mx-auto px-6">
          <h2 className="font-display text-3xl font-bold mb-8 leading-tight">Команда</h2>
          <p className="text-ink-secondary leading-relaxed mb-5">
            ИСПУМ создаётся небольшой командой инженеров и методистов. Мы строим платформу итеративно — выпускаем функции небольшими шагами, прислушиваемся к преподавателям, которые ими пользуются, и быстро исправляем то, что работает не так, как должно.
          </p>
          <p className="text-ink-secondary leading-relaxed mb-8">
            Если у вас есть идея, обратная связь или сложный сценарий, который не получается решить в ИСПУМ — напишите нам. Каждое сообщение от преподавателя читается живым человеком, обычно в течение суток.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/contact" className="inline-block px-6 py-2.5 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface-warm transition-colors">
              Связаться с командой
            </Link>
            <Link to="/feedback" className="inline-block px-6 py-2.5 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface-warm transition-colors">
              Поделиться обратной связью
            </Link>
          </div>
        </div>
      </section>

      {/* CTA — calmer than landing */}
      <section className="bg-surface-warm border-t border-border py-24">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="font-display text-3xl font-bold mb-5 leading-tight">
            Если эта философия близка — заходите.
          </h2>
          <p className="text-ink-secondary mb-10 leading-relaxed">
            Бесплатный тариф позволит спокойно посмотреть, как ИСПУМ работает с вашими задачами. Без обязательств, без привязки карты.
          </p>
          <Link to="/register" className="inline-block px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
            Попробовать ИСПУМ
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Principle({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-7">
      <div className="text-xs font-mono text-amber mb-3 tracking-wider">{number}</div>
      <h3 className="font-display text-xl font-bold mb-3 leading-snug">{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{body}</p>
    </div>
  )
}
