import { useState } from 'react'
import { motion } from 'motion/react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import Icon, { type IconName } from '../components/ui/Icon'
import SuccessMark from '../components/ui/SuccessMark'
import { submitContactMessage } from '../api/contact'

const NAVY = '#101B33'

// Shared motion variants — subtle fade + rise, matching the page's measured
// tone (no bounce/scale theatrics). `stagger` containers set initial/whileInView
// once; children just declare `variants={fadeUp}` and inherit hidden→visible
// from the nearest ancestor, so card grids advance one at a time on scroll.
const fadeUp = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
} as const
const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06 } },
} as const
// `amount: 0` + a negative bottom margin fires the reveal as soon as a
// section's top edge crosses ~15% above the viewport bottom, instead of
// waiting for 20% of a tall multi-card grid's own height to be on-screen —
// on a 4-card row that delay made the cards visibly pop in well after the
// section already looked "in view", which read as broken content rather
// than an animation.
const revealProps = {
  initial: 'hidden' as const,
  whileInView: 'visible' as const,
  viewport: { once: true, amount: 0 as const, margin: '0px 0px -15% 0px' },
}

export default function Research() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">

        {/* Hero — dark navy, title-slide feel matching the 14-slide deck */}
        <section
          className="relative px-6 py-24 overflow-hidden"
          style={{
            backgroundColor: NAVY,
            backgroundImage:
              'radial-gradient(ellipse 900px 500px at 50% -10%, rgba(200,134,10,0.20), transparent 65%)',
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'linear-gradient(to bottom, black, transparent)',
            }}
            aria-hidden="true"
          />
          <motion.div
            className="relative max-w-[780px] mx-auto text-center"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeUp} className="text-sm font-bold text-amber uppercase tracking-wider mb-4">Исследовательская программа ИСПУМ</motion.div>
            <motion.h1 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8 text-white">
              То, что раньше никто не измерял в оценивании — теперь измеримо.
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg text-white/70 mb-10 leading-relaxed max-w-[620px] mx-auto">
              ИСПУМ работает с вузами не только как поставщик ПО, но и как исследовательский партнёр: мы измеряем,
              что на самом деле происходит с оцениванием, доверием к рекомендациям платформы и архитектурой
              образовательных программ — и публикуем результаты в рецензируемых изданиях.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row justify-center gap-3">
              <a href="#contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
                Стать партнёром программы
              </a>
              <a href="#format" className="px-8 py-3 rounded-md border border-white/25 bg-transparent text-white font-medium hover:bg-white/10 transition-colors">
                Как это устроено
              </a>
            </motion.div>
          </motion.div>
        </section>

        {/* Формат сотрудничества */}
        <section id="format" className="py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Формат сотрудничества</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[620px] mx-auto">
              Без внедрения «на всю кафедру» и без обязательств по закупке. Пилот устроен так, чтобы вуз мог оценить
              результат прежде, чем принимать решение о масштабировании.
            </p>
            <motion.div className="relative grid md:grid-cols-4 gap-6" variants={stagger} {...revealProps}>
              <div
                className="hidden md:block absolute top-[27px] left-[12.5%] right-[12.5%] h-px bg-border-mid"
                aria-hidden="true"
              />
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
            </motion.div>
          </div>
        </section>

        {/* 4 направления исследований */}
        <section className="bg-surface-warm py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Направления исследований</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[640px] mx-auto">
              Каждое направление отвечает на вопрос о вашем вузе, который сегодня обсуждается на уровне мнений —
              и впервые становится измеримым. Не через опросы и самоотчёты, а по фиксируемым действиям
              преподавателя в реальном рабочем процессе.
            </p>
            <motion.div className="grid md:grid-cols-2 gap-6" variants={stagger} {...revealProps}>
              <DirectionCard icon="scale" title="Неявные критерии оценивания">
                По каким критериям преподаватели на самом деле ставят оценки — помимо заявленных в формальной
                рубрике? Где практика оценивания расходится с документами — прямой материал для методической
                работы и пересмотра рубрик.
              </DirectionCard>
              <DirectionCard icon="bar-chart" title="Согласованность оценивания во времени">
                Становится ли оценивание на кафедре более последовательным от семестра к семестру — и что на это
                влияет? Впервые это можно наблюдать как серию измерений, а не разовый срез.
              </DirectionCard>
              <DirectionCard icon="layers" title="Архитектура образовательных программ">
                Где в ваших программах дублируется содержание дисциплин и где нарушена логика пререквизитов?
                Диагностика по всей программе сразу — основа для аккредитационной отчётности и пересмотра
                учебных планов.
              </DirectionCard>
              <DirectionCard icon="shield" title="Как преподаватели работают с ассистентом">
                При каких условиях преподаватели доверяют инструментам поддержки, а при каких — отвергают их?
                Ответ на вопрос, который встанет перед каждым вузом при любом внедрении: не заменяет ли система
                преподавателя — и как выстроить работу так, чтобы решение всегда оставалось за ним.
              </DirectionCard>
            </motion.div>
          </div>
        </section>

        {/* Ценность для университета */}
        <section className="py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Ценность для университета</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[640px] mx-auto">
              Партнёрство даёт разную ценность на трёх уровнях — и часть этой ценности растёт вместе с сетью партнёров.
            </p>
            <motion.div className="grid md:grid-cols-3 gap-6 mb-10" variants={stagger} {...revealProps}>
              <ValueTier title="Кафедра и методический центр">
                Диагностика по собственной программе: где рубрики расходятся с практикой преподавателя, где
                дублируется содержание дисциплин, где нарушена логика пререквизитов. Доступна уже по итогам
                первого исследования.
              </ValueTier>
              <ValueTier title="Проректорат по научной работе">
                Соавторство в публикациях по теме, где практически нет русскоязычных эмпирических данных —
                научная ценность для отчётности вуза и публикационных показателей.
              </ValueTier>
              <ValueTier title="Партнёрская сеть">
                Обезличенные межвузовские показатели — доступные только благодаря участию нескольких университетов.
                Раздел бенчмарков наполняется по мере роста сети: первые партнёры получают показатели по своей
                программе, сравнительные данные — по мере присоединения новых вузов.
              </ValueTier>
            </motion.div>
            <motion.ul className="grid sm:grid-cols-2 gap-x-10 gap-y-4 max-w-[820px] mx-auto" variants={stagger} {...revealProps}>
              <BenefitItem>
                Доступ к тарифу <b>Институт</b> на весь период пилота — без оплаты, на условиях исследовательского партнёрства.
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
            </motion.ul>
          </div>
        </section>

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
    <motion.div variants={fadeUp} className="relative z-10 bg-surface border border-border rounded-xl p-6 transition-shadow hover:shadow-md">
      <div className="w-9 h-9 rounded-full bg-amber-light flex items-center justify-center text-amber font-bold text-base mb-5 ring-4 ring-bg">{n}</div>
      <h3 className="font-bold text-base mb-3 leading-snug">{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </motion.div>
  )
}

function DirectionCard({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="bg-surface border border-border rounded-xl p-6 transition-shadow hover:shadow-md">
      <div className="w-10 h-10 rounded-full bg-amber-light flex items-center justify-center text-amber mb-4">
        <Icon name={icon} size={18} />
      </div>
      <h3 className="font-display text-xl font-bold mb-3" style={{ color: NAVY }}>{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </motion.div>
  )
}

function ValueTier({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="bg-surface-warm border border-border rounded-xl p-6">
      <h3 className="font-bold text-base mb-3" style={{ color: NAVY }}>{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </motion.div>
  )
}

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <motion.li variants={fadeUp} className="flex gap-4 items-start">
      <span className="w-7 h-7 rounded-full bg-amber-light text-amber flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon name="check" size={14} />
      </span>
      <span className="text-ink-secondary leading-relaxed pt-0.5">{children}</span>
    </motion.li>
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
            <SuccessMark tone="success" size="md" />
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
