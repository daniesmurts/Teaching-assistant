import { useState } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import ResearchPartners from '../components/research/ResearchPartners'
import { submitContactMessage } from '../api/contact'

const NAVY = '#101B33'

export default function Research() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">

        {/* Hero — dark navy, title-slide feel matching the 14-slide deck */}
        <section className="px-6 py-24" style={{ backgroundColor: NAVY }}>
          <div className="max-w-[780px] mx-auto text-center">
            <div className="text-sm font-bold text-amber uppercase tracking-wider mb-4">Исследовательская программа ИСПУМ</div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8 text-white">
              Мы не продаём доступ. Мы собираем доказательную базу.
            </h1>
            <p className="text-lg text-white/70 mb-10 leading-relaxed max-w-[620px] mx-auto">
              ИСПУМ работает с вузами не только как поставщик ПО, но и как исследовательский партнёр: совместно с кафедрами
              мы измеряем, что на самом деле происходит с оцениванием, обратной связью и нагрузкой преподавателя — и
              публикуем результат, а не маркетинговые обещания.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <a href="#contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
                Стать партнёром программы
              </a>
              <a href="#format" className="px-8 py-3 rounded-md border border-white/25 bg-transparent text-white font-medium hover:bg-white/10 transition-colors">
                Как это устроено
              </a>
            </div>
          </div>
        </section>

        {/* Формат сотрудничества */}
        <section id="format" className="py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Формат сотрудничества</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[620px] mx-auto">
              Без внедрения «на всю кафедру» и без обязательств по закупке. Пилот устроен так, чтобы вуз мог оценить
              результат прежде, чем принимать решение о масштабировании.
            </p>
            <div className="grid md:grid-cols-4 gap-6">
              <FormatStep n="1" title="Пилотная группа">
                Кафедра выделяет 5–10 преподавателей и один-два потока студентов на семестр. Доступ к тарифу Институт —
                на условиях исследовательского партнёрства, без коммерческих обязательств.
              </FormatStep>
              <FormatStep n="2" title="Совместная методология">
                Мы согласуем с кафедрой, что именно измеряем — согласованность оценок, качество обратной связи,
                покрытие программы, время преподавателя — и фиксируем это до начала пилота.
              </FormatStep>
              <FormatStep n="3" title="Сбор данных">
                Платформа работает в штатном режиме в течение семестра. Все данные остаются в периметре вуза, тезисы
                исследования обезличены до анализа.
              </FormatStep>
              <FormatStep n="4" title="Отчёт и публикация">
                По итогам — совместный отчёт для кафедры и методического отдела. Публикация результатов — только с
                согласия вуза, вуз указывается как соавтор.
              </FormatStep>
            </div>
          </div>
        </section>

        {/* 4 направления исследований */}
        <section className="bg-surface-warm py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Направления исследований</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[620px] mx-auto">
              Каждое направление отвечает на вопрос, который сегодня в большинстве вузов не измеряется системно —
              только собирается вручную и от случая к случаю.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <DirectionCard title="Калибровка оценивания">
                Насколько согласованно преподаватели одной кафедры оценивают сопоставимые работы — и меняется ли
                строгость оценки преподавателя от начала к концу семестра. Сегодня это почти нигде не измеряется;
                мы делаем это через сравнение эмбеддингов схожих работ.
              </DirectionCard>
              <DirectionCard title="Обратная связь и результаты">
                Как качество и глубина обратной связи студенту связаны с последующей динамикой его оценок. Цель —
                показать не «студентам нравится отзыв», а «отзыв определённого типа даёт измеримый результат».
              </DirectionCard>
              <DirectionCard title="Согласованность программ">
                Совпадает ли то, что заявлено в РПД и компетенциях, с тем, что реально преподаётся и проверяется —
                по разделам, по дисциплинам, по всей образовательной программе. Основа для аккредитационной отчётности.
              </DirectionCard>
              <DirectionCard title="Время преподавателя">
                Сколько часов в неделю реально уходит на проверку работ и подготовку материалов — и что происходит с
                этим временем при внедрении ассистента. Не оценка «сколько мы обещаем сэкономить», а измерение факта.
              </DirectionCard>
            </div>
          </div>
        </section>

        {/* Что получает университет */}
        <section className="py-24 border-b border-border">
          <div className="max-w-[820px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-14" style={{ color: NAVY }}>Что получает университет</h2>
            <ul className="space-y-5">
              <BenefitItem>
                Доступ к тарифу <b>Институт</b> на весь период пилота — без оплаты, на условиях исследовательского партнёрства.
              </BenefitItem>
              <BenefitItem>
                Собственную аналитику по кафедре: калибровка оценок, покрытие программы, динамика нагрузки — то, что
                сегодня собирается вручную неделями.
              </BenefitItem>
              <BenefitItem>
                Совместный отчёт, пригодный для аккредитационной документации и внутренних отчётов методического отдела.
              </BenefitItem>
              <BenefitItem>
                Право соавторства в публикациях по итогам исследования — данные не публикуются без согласия вуза.
              </BenefitItem>
              <BenefitItem>
                Прямое влияние на развитие продукта: приоритет запросов кафедры в дорожной карте платформы.
              </BenefitItem>
            </ul>
          </div>
        </section>

        <ResearchPartners />

        {/* Форма заявки / контакт */}
        <ContactSection />

      </main>

      <PublicFooter />
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function FormatStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="w-9 h-9 rounded-full bg-amber-light flex items-center justify-center text-amber font-bold text-base mb-5">{n}</div>
      <h3 className="font-bold text-base mb-3 leading-snug">{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function DirectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h3 className="font-display text-xl font-bold mb-3" style={{ color: NAVY }}>{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-4 items-start">
      <span className="w-7 h-7 rounded-full bg-amber-light text-amber flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5">✓</span>
      <span className="text-ink-secondary leading-relaxed pt-0.5">{children}</span>
    </li>
  )
}

function ContactSection() {
  const [formState, setFormState] = useState({ name: '', university: '', email: '', message: '' })
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await submitContactMessage({
        name: formState.name,
        email: formState.email,
        organization: formState.university,
        topic: 'research',
        message: formState.message,
        sourcePage: 'research',
      })
      setIsSubmitted(true)
    } catch {
      // Global error toast (client.ts) already surfaced the failure.
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section id="contact" className="bg-surface-warm py-24">
      <div className="max-w-[700px] mx-auto px-6">
        <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Подать заявку</h2>
        <p className="text-ink-secondary text-center mb-12 max-w-[520px] mx-auto">
          Расскажите о своей кафедре — мы ответим в течение рабочего дня. Можно также написать напрямую на{' '}
          <a href="mailto:hello@ispum.ru" className="text-amber hover:underline">hello@ispum.ru</a>.
        </p>

        {isSubmitted ? (
          <div className="bg-success-bg border border-success p-8 rounded-xl text-center max-w-[500px] mx-auto">
            <div className="w-12 h-12 bg-success text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">✓</div>
            <h3 className="font-bold text-lg mb-2 text-success">Заявка отправлена!</h3>
            <p className="text-sm text-success/80">Мы получили вашу заявку и свяжемся с вами в ближайшее время.</p>
            <button onClick={() => setIsSubmitted(false)} className="mt-6 text-sm font-medium text-success hover:underline">
              Отправить ещё одну заявку
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-[500px] mx-auto">
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">Ваше имя</label>
              <input
                type="text"
                id="name"
                required
                value={formState.name}
                onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                placeholder="Иван Иванов"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="university" className="text-sm font-medium">Университет / кафедра</label>
              <input
                type="text"
                id="university"
                required
                value={formState.university}
                onChange={(e) => setFormState({ ...formState, university: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                placeholder="Например, КНИТУ, кафедра..."
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <input
                type="email"
                id="email"
                required
                value={formState.email}
                onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                placeholder="ivan@university.edu"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="message" className="text-sm font-medium">Сообщение</label>
              <textarea
                id="message"
                rows={4}
                value={formState.message}
                onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm resize-none"
                placeholder="Кратко о кафедре и почему интересен пилот"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-amber hover:bg-amber/90 disabled:opacity-60 text-white font-medium py-2.5 rounded-md transition-colors"
            >
              {isSubmitting ? 'Отправка…' : 'Отправить заявку'}
            </button>
            <p className="text-xs text-ink-tertiary text-center mt-2">
              Нажимая кнопку «Отправить заявку», вы соглашаетесь с <a href="/privacy" className="underline hover:text-ink">политикой конфиденциальности</a>.
            </p>
          </form>
        )}
      </div>
    </section>
  )
}
