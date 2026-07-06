import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import Icon, { type IconName } from '../components/ui/Icon'

export default function Institutions() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">

        {/* Hero */}
        <section
          className="relative px-6 pt-24 pb-20 text-center overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(ellipse 900px 460px at 50% -5%, rgba(200,134,10,0.10), transparent 65%)' }}
        >
          <div className="relative max-w-[820px] mx-auto">
          <div className="text-sm font-bold text-amber uppercase tracking-wider mb-4">Для ВУЗов и кафедр</div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8">
            Одна платформа. Вся кафедра. Единый стандарт.
          </h1>
          <p className="text-lg text-ink-secondary mb-10 leading-relaxed max-w-[620px] mx-auto">
            ИСПУМ для институтов — это всё из тарифа Pro для каждого преподавателя, плюс инструменты управления для деканата и кафедры: общие рубрики, массовое подключение, аналитика, журнал действий. Размещение в Российской Федерации, без VPN.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link to="/contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
              Запросить коммерческое предложение
            </Link>
            <Link to="/contact" className="px-8 py-3 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface transition-colors">
              Записаться на демо
            </Link>
          </div>
          <p className="text-xs text-ink-tertiary mt-6">
            Пилот на 5–10 преподавателей · Расчёт под вашу кафедру · Соглашение об обработке ПДн (152-ФЗ) по запросу
          </p>
          </div>
        </section>

        {/* Знакомая ситуация — institutional pain */}
        <section className="bg-surface-warm py-20 border-y border-border">
          <div className="max-w-[820px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-12">Знакомая ситуация?</h2>
            <div className="grid md:grid-cols-2 gap-5">
              <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
                <div className="text-amber font-display text-xl font-bold mb-2">«У нас в кафедре нет единого стандарта»</div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Один преподаватель ставит «отлично», другой за такую же работу — «удовлетворительно». Студенты пишут жалобы, методист тратит время на разбирательства.
                </p>
              </div>
              <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
                <div className="text-amber font-display text-xl font-bold mb-2">«В сезон ВКР преподаватели горят»</div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Май–июнь — каждый научный руководитель читает 4–8 дипломов по 70+ страниц. Качество рецензий падает, выходные уходят, накапливается усталость.
                </p>
              </div>
              <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
                <div className="text-amber font-display text-xl font-bold mb-2">«Нет данных для отчётов и аккредитации»</div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Методический отдел не видит, какие компетенции западают на потоке. Аналитика собирается вручную из Excel-таблиц десятков преподавателей.
                </p>
              </div>
              <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
                <div className="text-amber font-display text-xl font-bold mb-2">«ИТ-отдел против иностранных SaaS»</div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Решения с серверами за рубежом не проходят согласование по 152-ФЗ. Требуется VPN — а это барьер и для преподавателей, и для службы безопасности.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features — 6 blocks */}
        <section className="py-24">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-4">Что входит в институт-тариф</h2>
            <p className="text-ink-secondary text-center mb-14 max-w-[600px] mx-auto">
              Все возможности Pro доступны каждому преподавателю кафедры. Плюс инструменты для администрирования, контроля и отчётности.
            </p>

            <div className="grid md:grid-cols-3 gap-6">
              <FeatureBlock icon="list-checks" title="Общие рубрики кафедры">
                Создавайте и распространяйте критерии оценки на всю кафедру. Все преподаватели работают по единым стандартам — без «разнобоя» и студенческих жалоб.
              </FeatureBlock>
              <FeatureBlock icon="layers" title="Рецензирование ВКР и дипломов">
                Работа на 80 страниц разбирается поразделно: оценка, разбор по главам, вопросы к защите. Научный руководитель проверяет и утверждает результат.
              </FeatureBlock>
              <FeatureBlock icon="users" title="Массовое подключение преподавателей">
                Загрузите список адресов — приглашения отправятся одним нажатием. Или укажите домен (например, <code className="text-amber font-mono">@university.ru</code>) — преподаватели присоединятся автоматически.
              </FeatureBlock>
              <FeatureBlock icon="bar-chart" title="Аналитика по студентам и группам">
                Профиль каждого студента, динамика оценок по времени, средние баллы по группе. Методический отдел видит общую картину — и где нужна поддержка.
              </FeatureBlock>
              <FeatureBlock icon="clock" title="Журнал действий и админ-панель">
                Контроль приглашений, активаций и общих рубрик. Прозрачность для деканата и службы безопасности. Полный список действий администраторов.
              </FeatureBlock>
              <FeatureBlock icon="scale" title="Расчётные задачи и STEM">
                Физика, математика, инженерные дисциплины — ИСПУМ пошагово пересчитывает решения, проверяет формулы, единицы измерения и размерности. Для технических факультетов.
              </FeatureBlock>
            </div>
          </div>
        </section>

        {/* ВКР showcase — killer feature */}
        <section className="bg-surface-warm py-24 border-y border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <div className="text-xs font-bold text-amber uppercase tracking-wider mb-3">Сезон защит</div>
            <h2 className="font-display text-3xl font-bold mb-6 leading-tight">Майские праздники — у преподавателей, не за столом с дипломами.</h2>
            <p className="text-ink-secondary text-lg mb-10 max-w-[700px] leading-relaxed">
              ВКР на 70 страниц обычно занимает у научного руководителя весь воскресный вечер. ИСПУМ разбирает её за минуты — и возвращает преподавателю готовую структуру рецензии.
            </p>

            <div className="bg-surface border border-border rounded-xl p-8 grid md:grid-cols-2 gap-8">
              <div>
                <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-3">Что делает ИСПУМ</div>
                <ul className="space-y-3 text-sm text-ink-secondary">
                  <li className="flex gap-3"><Icon name="sparkle" size={15} className="text-amber flex-shrink-0 mt-0.5" /><span>Разбивает работу на разделы и анализирует каждый</span></li>
                  <li className="flex gap-3"><Icon name="sparkle" size={15} className="text-amber flex-shrink-0 mt-0.5" /><span>Оценивает структуру, аргументацию, источники, новизну</span></li>
                  <li className="flex gap-3"><Icon name="sparkle" size={15} className="text-amber flex-shrink-0 mt-0.5" /><span>Формирует разбор по главам — что сильно, что слабо</span></li>
                  <li className="flex gap-3"><Icon name="sparkle" size={15} className="text-amber flex-shrink-0 mt-0.5" /><span>Предлагает рекомендуемую оценку и комментарий</span></li>
                  <li className="flex gap-3"><Icon name="sparkle" size={15} className="text-amber flex-shrink-0 mt-0.5" /><span>Готовит вопросы для защиты перед комиссией</span></li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-3">Что остаётся преподавателю</div>
                <ul className="space-y-3 text-sm text-ink-secondary">
                  <li className="flex gap-3"><Icon name="check" size={15} className="text-success flex-shrink-0 mt-0.5" /><span>Прочитать сжатый разбор за 10 минут</span></li>
                  <li className="flex gap-3"><Icon name="check" size={15} className="text-success flex-shrink-0 mt-0.5" /><span>Скорректировать оценку, если нужно</span></li>
                  <li className="flex gap-3"><Icon name="check" size={15} className="text-success flex-shrink-0 mt-0.5" /><span>Утвердить рецензию — она сохранится в журнале</span></li>
                  <li className="flex gap-3"><Icon name="check" size={15} className="text-success flex-shrink-0 mt-0.5" /><span>Использовать вопросы к защите без подготовки</span></li>
                </ul>
                <div className="mt-6 px-4 py-3 bg-amber-light border border-amber/20 rounded-lg text-sm">
                  <span className="font-semibold text-ink">Финальное слово — за преподавателем.</span>
                  <span className="text-ink-secondary"> ИИ не выставляет оценку самостоятельно.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* For each decision-maker */}
        <section className="py-24">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-14">Кому ИСПУМ помогает в вузе</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <RoleCard
                role="Декану и заведующему кафедрой"
                items={[
                  'Единый стандарт оценки — меньше жалоб',
                  'Сокращение нагрузки преподавателей',
                  'Аналитика для отчётов и аккредитации',
                  'Контроль качества по всей кафедре',
                ]}
              />
              <RoleCard
                role="IT-отделу и службе безопасности"
                items={[
                  'Размещение в РФ (Яндекс.Облако, Москва)',
                  'Соглашение об обработке ПДн (152-ФЗ)',
                  'Авто-вход по корпоративному домену',
                  'Журнал действий администраторов',
                ]}
              />
              <RoleCard
                role="Методическому отделу"
                items={[
                  'Общие рубрики и шаблоны на кафедру',
                  'Аналитика по группам и потокам',
                  'CSV-выгрузка оценок (совместимо с Moodle)',
                  'Данные для развития программ',
                ]}
              />
            </div>
          </div>
        </section>

        {/* Trust & infra */}
        <section className="bg-surface-warm py-20 border-y border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-3">Безопасность и инфраструктура</h2>
            <p className="text-ink-secondary text-center mb-12 max-w-[650px] mx-auto">
              ИСПУМ построен на российской инфраструктуре. Без иностранных подрядчиков для хранения данных, без VPN для доступа из университетских сетей.
            </p>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
              <TrustCard icon="building" title="Хостинг в РФ" body="Яндекс.Облако, Москва. Без зарубежных серверов." />
              <TrustCard icon="file-check" title="152-ФЗ" body="Соглашение об обработке ПДн под кафедру или факультет — по запросу." />
              <TrustCard icon="shield" title="Без VPN" body="Работает из любой университетской сети. Не блокируется." />
              <TrustCard icon="clock" title="Журнал действий" body="Все действия администраторов видны. Прозрачность для ИБ-службы." />
            </div>
          </div>
        </section>

        {/* ROI — revised, defensible */}
        <section className="py-24">
          <div className="max-w-[820px] mx-auto px-6 text-center">
            <h2 className="font-display text-3xl font-bold mb-3">Эффект для кафедры</h2>
            <p className="text-ink-secondary mb-14 max-w-[560px] mx-auto">
              Ниже — ожидаемый эффект на основании пилотных групп. Точные показатели зависят от размера кафедры и типа работ.
            </p>
            <div className="grid sm:grid-cols-3 gap-8 text-left">
              <div className="text-center">
                <div className="text-5xl font-display font-bold text-amber mb-3">до 80%</div>
                <div className="text-sm font-medium text-ink-secondary leading-relaxed">сокращение времени первичной проверки работ</div>
              </div>
              <div className="text-center">
                <div className="text-5xl font-display font-bold text-amber mb-3">1 день</div>
                <div className="text-sm font-medium text-ink-secondary leading-relaxed">массовое подключение всей кафедры через приглашения или домен</div>
              </div>
              <div className="text-center">
                <div className="text-5xl font-display font-bold text-amber mb-3">100%</div>
                <div className="text-sm font-medium text-ink-secondary leading-relaxed">данных хранятся в России, соответствует требованиям 152-ФЗ</div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ — procurement Q&A */}
        <section className="bg-surface-warm py-24 border-y border-border">
          <div className="max-w-[820px] mx-auto px-6">
            <h2 className="font-display text-3xl font-bold text-center mb-14">Частые вопросы</h2>
            <div className="space-y-5">
              <FAQ q="Где физически хранятся данные?">
                В Яндекс.Облаке, дата-центры в Российской Федерации. Студенческие работы, оценки, файлы — всё на российских серверах. Без зарубежных подрядчиков для хранения.
              </FAQ>
              <FAQ q="Как обстоит дело с 152-ФЗ?">
                Соглашение об обработке ПДн готовится индивидуально под вашу кафедру или факультет. Запросите шаблон при обсуждении пилота — мы передадим его юристам организации.
              </FAQ>
              <FAQ q="Как происходит подключение кафедры?">
                Этапы: знакомство и демо (30–45 минут) → пилот на 5–10 преподавателях (2–4 недели) → договор и масштабирование. Договор можно заключить как через ИП, так и через юр. лицо по запросу.
              </FAQ>
              <FAQ q="Сколько это стоит?">
                Стоимость рассчитывается индивидуально — от числа мест, длительности контракта и состава функций. Оплата через банковский перевод по счёту, годовой контракт.
              </FAQ>
              <FAQ q="Интегрируется ли ИСПУМ с Moodle?">
                Да. Оценки выгружаются в CSV-формате, совместимом с импортом в Moodle. Если требуется более глубокая интеграция (LTI, SSO) — обсудим в рамках договора.
              </FAQ>
              <FAQ q="Требуется ли VPN или специальные настройки в университете?">
                Нет. ИСПУМ работает в любом современном браузере, без установки. Не блокируется российскими сетями, доступен из любой университетской вычислительной среды.
              </FAQ>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-24">
          <div className="max-w-[700px] mx-auto px-6 text-center">
            <h2 className="font-display text-3xl font-bold mb-5 leading-tight">Готовы посмотреть, как это работает у вас?</h2>
            <p className="text-ink-secondary mb-10 leading-relaxed">
              Покажем демо на ваших задачах, обсудим пилот на одну кафедру, подготовим коммерческое предложение под вашу организацию. Без обязательств.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
                Запросить КП
              </Link>
              <Link to="/contact" className="px-8 py-3 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface-warm transition-colors">
                Записаться на демо
              </Link>
            </div>
          </div>
        </section>

      </main>

      <PublicFooter />
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function FeatureBlock({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-6 rounded-xl border border-border transition-shadow hover:shadow-md">
      <div className="w-9 h-9 rounded-full bg-amber-light flex items-center justify-center text-amber mb-5">
        <Icon name={icon} size={16} />
      </div>
      <h3 className="font-bold text-base mb-3 leading-snug">{title}</h3>
      <p className="text-sm text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function RoleCard({ role, items }: { role: string; items: string[] }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6 transition-shadow hover:shadow-md">
      <div className="text-xs font-bold text-amber uppercase tracking-wider mb-3 leading-snug">{role}</div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm text-ink-secondary leading-relaxed">
            <Icon name="check" size={13} className="text-amber flex-shrink-0 mt-1" /><span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
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

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="bg-surface border border-border rounded-xl p-5 group">
      <summary className="font-semibold text-sm cursor-pointer flex items-center justify-between">
        <span>{q}</span>
        <span className="text-amber text-lg leading-none transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="text-sm text-ink-secondary leading-relaxed mt-3 pr-7">{children}</p>
    </details>
  )
}
