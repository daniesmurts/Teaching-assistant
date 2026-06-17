import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function Changelog() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[800px] mx-auto w-full px-6 py-16 md:py-24">
        <h1 className="font-display text-4xl font-bold mb-4 text-center">Обновления платформы</h1>
        <p className="text-ink-secondary text-center mb-16 max-w-[500px] mx-auto">
          Мы постоянно улучшаем ИСПУМ, чтобы сэкономить ваше время. Здесь вы найдете историю последних изменений и новых функций.
        </p>

        <div className="space-y-12 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
          
          {/* Version 1.4 — latest */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-amber text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.4</span>
                <span className="text-xs font-medium text-amber px-2 py-1 rounded bg-amber-light/20">Новое</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Июль 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Переработка работ — с учётом прошлых замечаний.</strong> Когда студент сдаёт улучшенную версию, ИСПУМ сравнивает её с прошлой и по каждому замечанию явно отмечает: учтено, частично учтено или нет. Преподаватель сразу видит, что было сделано — без перечитывания обеих версий заново.</p>
                <p><strong>Тесты по материалам предмета.</strong> Соберите контрольную за минуту — от 5 до 20 вопросов с вариантами ответов и пояснениями. Три уровня сложности: запоминание, понимание, применение. Вопросы опираются на материалы вашего предмета и сопровождаются ссылками на источник, чтобы вы могли быстро проверить корректность.</p>
                <p><strong>Генератор тем для исследований и практик.</strong> Опишите студента — уровень обучения, направление, интересы, место практики. ИСПУМ предложит конкретные темы для ВКР, курсовых и производственной практики, грунтованные на актуальном поиске. Темы привязываются к студенту — можно вернуться к ним позже.</p>
                <p><strong>Привычная российская шкала 5–4–3–2.</strong> Ушли от «университетских» A–B–C–D–F: оценки выставляются по понятной для всех российской пятибалльной шкале.</p>
                <p><strong>Кафедра «под ключ» — массовое подключение.</strong> Приглашайте десятки преподавателей одним списком или автоматически по корпоративному домену (<code>@university.ru</code>). Все приглашённые получают полный Pro-доступ сразу, а действия администраторов фиксируются в журнале.</p>
                <p><strong>Редактирование пунктов перед утверждением.</strong> Прежде чем подтвердить оценку, преподаватель может править, удалять и добавлять пункты «сильные стороны» и «что улучшить» — именно отредактированные пункты будут проверены при следующей версии работы.</p>
                <p><strong>ВКР-разбор с цитатами.</strong> Каждый плюс и каждое замечание в разборе подкреплены точной цитатой из работы — видно, на чём основан вывод. В начале отчёта появился блок «Что проверено»: где материала хватило для уверенного суждения, а где стоит обратить внимание самостоятельно.</p>
                <p><strong>Поиск противоречий в данных ВКР.</strong> ИСПУМ сверяет ключевые величины — плотности, температуры, размеры выборок, сроки — между разделами работы. Если одна и та же величина в одной главе указана как 850, а в другой как 920, вы получите блок «Противоречия в данных» со всеми упоминаниями и кратким описанием, что не сходится.</p>
              </div>
            </div>
          </div>

          {/* Version 1.3 */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-surface-warm text-ink-tertiary shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm opacity-80 transition-opacity hover:opacity-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.3</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Июнь 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Рецензирование больших работ (ВКР и дипломы).</strong> Загрузите объёмную работу — ИСПУМ разберёт её по разделам, отметит сильные стороны и замечания и предложит вопросы к защите.</p>
                <p><strong>Журнал проверок.</strong> Все проверенные работы в одном месте: поиск по студенту и группе, фильтры и быстрый доступ к любой прошлой оценке.</p>
                <p><strong>Командная работа для кафедр и вузов.</strong> Приглашайте преподавателей, делитесь общими рубриками и отслеживайте активность — в единой панели администратора.</p>
                <p><strong>Экспорт оценок.</strong> Выгрузка результатов в CSV, совместимую с Moodle.</p>
              </div>
            </div>
          </div>

          {/* Version 1.2 */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-surface-warm text-ink-tertiary shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm opacity-80 transition-opacity hover:opacity-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.2</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Апрель 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Проверка расчётных задач.</strong> Физика, математика, инженерия — ИИ пошагово пересчитывает решение, проверяет формулы, размерности и единицы измерения.</p>
                <p><strong>Загрузка документов.</strong> PDF, Word и сканы — текст распознаётся автоматически, включая рукописный (OCR).</p>
                <p><strong>ИИ учится на ваших оценках.</strong> Чем больше работ вы проверяете, тем точнее рекомендации под ваш стиль (технология RAG).</p>
                <p><strong>Письма с отзывами.</strong> Готовый черновик письма студенту — в один клик.</p>
              </div>
            </div>
          </div>

          {/* Version 1.1 */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-surface-warm text-ink-tertiary shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm opacity-80 transition-opacity hover:opacity-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.1</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Февраль 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Генератор лекций.</strong> Структура презентации по теме и уровню аудитории — с тезисами и заметками для докладчика, готовая к переносу в PowerPoint.</p>
                <p><strong>Конструктор рубрик.</strong> Критерии с весами в процентах — оценка строго по вашим правилам.</p>
                <p><strong>Аналитика успеваемости.</strong> Профиль каждого студента и динамика его оценок по времени.</p>
              </div>
            </div>
          </div>

          {/* Version 1.0 */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-surface-warm text-ink-tertiary shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm opacity-80 transition-opacity hover:opacity-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.0 (Public Beta)</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Декабрь 2025</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Публичный запуск.</strong> Платформа ИСПУМ открыта для регистрации первых пользователей.</p>
                <p><strong>Проверка работ с ИИ.</strong> Оценка с разбором по критериям и развёрнутой обратной связью.</p>
                <p><strong>Человек всегда решает.</strong> Архитектура Human-in-the-loop: ИИ готовит черновик, преподаватель проверяет и утверждает.</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
