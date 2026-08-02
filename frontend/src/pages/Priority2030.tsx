import { useMemo, useState } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import Icon, { type IconName } from '../components/ui/Icon'
import SuccessMark from '../components/ui/SuccessMark'
import { submitContactMessage } from '../api/contact'

const NAVY = '#101B33'

export default function Priority2030() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">

        {/* Hero — dark navy, restrained tone for a proректорат reader */}
        <section
          className="relative px-6 py-24 overflow-hidden"
          style={{
            backgroundColor: NAVY,
            backgroundImage: 'radial-gradient(ellipse 900px 500px at 50% -10%, rgba(200,134,10,0.20), transparent 65%)',
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
          <div className="relative max-w-[820px] mx-auto text-center">
            <div className="text-sm font-bold text-amber uppercase tracking-wider mb-4">Для вузов — участников программ развития</div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8 text-white">
              Цифровая трансформация образовательной деятельности — с доказательной базой для отчёта
            </h1>
            <p className="text-lg text-white/70 mb-10 leading-relaxed max-w-[660px] mx-auto">
              «Приоритет 2030» требует от университета не деклараций, а измеримых результатов: политика в области
              цифровой трансформации, политика в области образовательной деятельности, переход к управлению на
              данных. ИСПУМ закрывает эти пункты программы развития — конкретными, отчётными цифрами.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <a href="#contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
                Обсудить пилот на кафедру
              </a>
              <a href="#mapping" className="px-8 py-3 rounded-md border border-white/25 bg-transparent text-white font-medium hover:bg-white/10 transition-colors">
                Как это соотносится с программой развития
              </a>
            </div>
            <p className="text-xs text-white/40 mt-6 max-w-[560px] mx-auto leading-relaxed">
              ИСПУМ не аффилирован с оператором программы «Приоритет 2030» и не гарантирует результаты отбора.
              Ниже — как платформа помогает закрывать конкретные направления программы развития университета.
            </p>
          </div>
        </section>

        {/* Проблема отчётности */}
        <section className="py-24 border-b border-border">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Знакомая ситуация к моменту ежегодного отчёта</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[620px] mx-auto">
              Программа развития заявляет политики — отчёт требует цифры за ними. Между заявленным и измеримым
              обычно разрыв, который закрывают вручную, за неделю до дедлайна.
            </p>
            <div className="grid md:grid-cols-3 gap-5">
              <ProblemCard title="Заявлено — не измерено">
                «Внедрены цифровые инструменты в образовательный процесс» в программе развития есть.
                Данных о том, где именно и с каким эффектом — нет ни у методического отдела, ни у ректората.
              </ProblemCard>
              <ProblemCard title="Ручной сбор с кафедр">
                Показатели по цифровизации и покрытию РПД компетенциями собираются вручную из Excel-таблиц
                десятков кафедр — раз в год, с ошибками и по памяти заведующих.
              </ProblemCard>
              <ProblemCard title="ППС без ресурса на науку">
                Показатели НИОКР и публикаций требуют времени преподавателя — которое целиком уходит на
                рутинную проверку студенческих работ, особенно в сезон ВКР.
              </ProblemCard>
            </div>
          </div>
        </section>

        {/* Таблица соответствия — the centerpiece */}
        <section id="mapping" className="bg-surface-warm py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Соответствие направлениям программы развития</h2>
            <p className="text-ink-secondary text-center mb-12 max-w-[680px] mx-auto">
              То, что чаще всего звучит как формулировка в документе, ИСПУМ переводит в измеримый результат —
              данные, которые ложатся прямо в годовой отчёт.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse bg-surface border border-border rounded-xl overflow-hidden text-sm">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="text-left px-5 py-4 font-bold text-ink w-[38%]">Направление программы развития</th>
                    <th className="text-left px-5 py-4 font-bold text-ink">Что даёт ИСПУМ как измеримый результат</th>
                  </tr>
                </thead>
                <tbody>
                  <MappingRow
                    direction="Политика в области цифровой трансформации"
                    result="Доля дисциплин и преподавателей с цифровой проверкой работ, число автоматизированных проверок за период, журнал действий — конкретные цифры вместо формулировки «внедрены инструменты»"
                  />
                  <MappingRow
                    direction="Политика в области образовательной деятельности"
                    result="Единые критерии и рубрики по кафедре, покрытие РПД компетенциями (обеспечена / частично / не обеспечена) с указанием пробелов — основа для пересмотра учебных планов"
                  />
                  <MappingRow
                    direction="Переход к системе управления на данных"
                    result="Институциональная аналитика: активность кафедр, распределение оценок по потокам, слабые места по компетенциям — без ручного сбора отчётов с факультетов"
                  />
                  <MappingRow
                    direction="Кадровая политика и научный потенциал ППС"
                    result="Прямой возврат времени преподавателя на проверку → ресурс на НИР и публикации, единственный ресурс, который не покупается за счёт гранта"
                  />
                  <MappingRow
                    direction="Работа с региональной экономикой и партнёрами"
                    result="Генератор кейсов, проектных и практических заданий, привязанных к реальным компетенциям программы — быстрее готовить материалы под запрос индустриального партнёра"
                  />
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Возврат часов ППС — interactive calculator */}
        <HoursCalculator />

        {/* Инфраструктура */}
        <section className="py-24 border-b border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-3" style={{ color: NAVY }}>Суверенная инфраструктура</h2>
            <p className="text-ink-secondary text-center mb-12 max-w-[650px] mx-auto">
              Для программы развития университета выбор стека — не мелочь, а часть политики цифровой
              трансформации. ИСПУМ построен без зарубежных подрядчиков для хранения данных.
            </p>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
              <TrustCard icon="building" title="Хостинг в РФ" body="Яндекс.Облако, Москва. Без зарубежных серверов." />
              <TrustCard icon="file-check" title="152-ФЗ" body="Соглашение об обработке ПДн под университет — по запросу." />
              <TrustCard icon="shield" title="SSO / LTI 1.3" body="Вход по корпоративному домену, интеграция с Moodle." />
              <TrustCard icon="clock" title="Журнал действий" body="Полная прозрачность для ИБ-службы и внутреннего аудита." />
            </div>
          </div>
        </section>

        {/* Пилот */}
        <section className="bg-surface-warm py-24 border-b border-border">
          <div className="max-w-[820px] mx-auto px-6 text-center">
            <h2 className="font-display text-3xl font-bold mb-5" style={{ color: NAVY }}>Пилот, а не закупка вслепую</h2>
            <p className="text-ink-secondary mb-12 leading-relaxed max-w-[620px] mx-auto">
              Одна кафедра, один семестр — на выходе отчёт с реальными цифрами по вашей программе, а не
              презентация с общими обещаниями.
            </p>
            <div className="grid sm:grid-cols-3 gap-6 text-left">
              <PilotStep n="1" title="Кафедра-пилот">
                5–10 преподавателей, один-два потока. Доступ к тарифу «Институт» на срок пилота.
              </PilotStep>
              <PilotStep n="2" title="Семестр в работе">
                Платформа работает в штатном режиме: проверка работ, критерии, аналитика — без изменения учебного процесса.
              </PilotStep>
              <PilotStep n="3" title="Отчёт с цифрами">
                Итоговый отчёт — покрытие РПД, часы, возвращённые ППС, данные по потокам — готов для программы развития.
              </PilotStep>
            </div>
          </div>
        </section>

        {/* Форма заявки */}
        <ContactSection />

      </main>

      <PublicFooter />
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function ProblemCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
      <div className="text-amber font-display text-lg font-bold mb-2">{title}</div>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function MappingRow({ direction, result }: { direction: string; result: string }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-5 py-4 align-top font-semibold text-ink">{direction}</td>
      <td className="px-5 py-4 align-top text-ink-secondary leading-relaxed">{result}</td>
    </tr>
  )
}

function TrustCard({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 text-center transition-shadow hover:shadow-md">
      <div className="w-9 h-9 rounded-full bg-amber-light flex items-center justify-center text-amber mx-auto mb-3">
        <Icon name={icon} size={16} />
      </div>
      <div className="font-bold text-sm mb-2">{title}</div>
      <p className="text-xs text-ink-secondary leading-relaxed">{body}</p>
    </div>
  )
}

function PilotStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="w-9 h-9 rounded-full bg-amber-light flex items-center justify-center text-amber font-bold text-base mb-4">{n}</div>
      <h3 className="font-bold text-base mb-2 leading-snug">{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function HoursCalculator() {
  const [teachers, setTeachers] = useState(20)
  const [worksPerTerm, setWorksPerTerm] = useState(150)
  const [minutesEach, setMinutesEach] = useState(25)

  const { totalHours, savedHours } = useMemo(() => {
    const totalMinutes = teachers * worksPerTerm * minutesEach
    const total = totalMinutes / 60
    // "до 80%" is the same figure used as the platform-wide ROI claim on
    // /institutions — kept in sync so the two pages don't quote different numbers.
    return { totalHours: Math.round(total), savedHours: Math.round(total * 0.8) }
  }, [teachers, worksPerTerm, minutesEach])

  return (
    <section className="py-24 border-b border-border">
      <div className="max-w-[900px] mx-auto px-6">
        <h2 className="font-display text-3xl font-bold text-center mb-3" style={{ color: NAVY }}>Возврат часов ППС в науку</h2>
        <p className="text-ink-secondary text-center mb-12 max-w-[620px] mx-auto">
          Единственный ресурс кафедры, который нельзя докупить за счёт гранта. Оцените порядок цифр для своей кафедры.
        </p>
        <div className="bg-surface border border-border rounded-xl p-8 grid md:grid-cols-2 gap-10">
          <div className="space-y-6">
            <CalcSlider
              label="Преподавателей на кафедре"
              value={teachers}
              min={5} max={100} step={5}
              onChange={setTeachers}
              suffix="чел."
            />
            <CalcSlider
              label="Проверяемых работ за семестр на преподавателя"
              value={worksPerTerm}
              min={20} max={400} step={10}
              onChange={setWorksPerTerm}
              suffix="работ"
            />
            <CalcSlider
              label="Времени на проверку одной работы сейчас"
              value={minutesEach}
              min={5} max={90} step={5}
              onChange={setMinutesEach}
              suffix="мин"
            />
          </div>
          <div className="bg-surface-warm rounded-xl p-8 flex flex-col justify-center text-center">
            <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-2">Сейчас на проверку уходит</div>
            <div className="font-display text-3xl font-bold mb-6" style={{ color: NAVY }}>{totalHours.toLocaleString('ru-RU')} ч / семестр</div>
            <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-2">Потенциально возвращается кафедре</div>
            <div className="font-display text-5xl font-bold text-amber mb-2">{savedHours.toLocaleString('ru-RU')} ч</div>
            <p className="text-xs text-ink-tertiary leading-relaxed">
              При сокращении времени первичной проверки до 80% — на основании пилотных групп. Точная цифра зависит от типа работ.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function CalcSlider({ label, value, min, max, step, onChange, suffix }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">{label}</label>
        <span className="text-sm font-bold text-amber">{value.toLocaleString('ru-RU')} {suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber"
      />
    </div>
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
        topic: 'demo',
        message: formState.message,
        sourcePage: 'priority2030',
      })
      setIsSubmitted(true)
    } catch {
      // Global error toast (client.ts) already surfaced the failure.
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section id="contact" className="py-24">
      <div className="max-w-[700px] mx-auto px-6">
        <h2 className="font-display text-3xl font-bold text-center mb-4" style={{ color: NAVY }}>Обсудить пилот на кафедру</h2>
        <p className="text-ink-secondary text-center mb-12 max-w-[520px] mx-auto">
          Расскажите о своём университете и программе развития — подготовим расчёт под вашу кафедру. Можно
          также написать напрямую на{' '}
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
                placeholder="Кратко о кафедре, программе развития и почему интересен пилот"
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
