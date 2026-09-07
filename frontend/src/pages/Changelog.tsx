import { useEffect, useState, type ReactNode } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

// The public «Обновления платформы» page. Content lives in this array rather
// than in the markup: the previous version repeated an identical 20-line card
// six times, which is why the newest release ended up with fourteen changes
// welded into one unscannable block of <p><strong>…</strong> …</p>.
//
// Each change is a title + a body, so the page can render them as headed rows
// the eye can skim, and so older releases can be collapsed to their first few
// entries instead of every release shouting equally loudly.
interface Change { title: string; body: ReactNode }
interface Release { version: string; anchor: string; month: string; dateTime: string; changes: Change[] }

const RELEASES: Release[] = [
  {
    version: 'Версия 1.6',
    anchor: 'v1-6',
    month: 'Сентябрь 2026',
    dateTime: '2026-09',
    changes: [
      { title: 'Лекция перестала быть «одноразовой»', body: 'Раньше готовую презентацию можно было либо принять как есть, либо перегенерировать целиком. Теперь каждый слайд правится отдельно: изменить текст и заметки, переписать один слайд по замечанию («короче», «добавь пример с числами»), удалить, переставить или добавить новый — остальные слайды при этом не трогаются.' },
      { title: 'План лекции — до генерации, а не после', body: 'ИСПУМ за несколько секунд показывает структуру будущей лекции: порядок, тип и краткое содержание каждого слайда. Порядок можно поменять, лишнее убрать, своё добавить — и только потом запускать написание текста и заметок. Поправить план — секунды, переделывать готовую лекцию — долго.' },
      { title: 'Загрузите свою презентацию', body: 'Уже накопленные .pptx больше не нужно переносить вручную: загрузите файл — ИСПУМ разберёт его по слайдам вместе с заметками докладчика, и дальше с ним можно всё то же самое, что с созданным в системе. Бесплатно и без расхода лимита генераций.' },
      { title: '«Проверить усвоение» — тест по лекции прямо в аудитории', body: 'По готовой лекции одной кнопкой собирается тест — не по теме вообще, а по вашим слайдам и заметкам, то есть по тому, что вы действительно рассказали. Его сразу можно запустить в аудитории: студенты отвечают с телефонов по QR-коду, а результаты сохраняются в журнал.' },
      { title: 'Раздатка для студентов', body: 'PDF по лекции: слайды и заметки как связный конспект — или тот же материал без конспекта, чтобы студенты писали сами.' },
      { title: 'Письменная работа по вопросам лекции', body: 'Слайды с вопросами для обсуждения превращаются в задание для студентов — с персональными ссылками, сроком сдачи и проверкой процесса написания.' },
      { title: 'Тема из рабочей программы', body: 'Тематический план один раз разбирается из РПД предмета — дальше тему и номер лекции можно выбрать из списка, а не вводить руками. Содержание темы из программы становится заданием для генерации, а готовая лекция остаётся связанной с темой — это материал для УМК.' },
      { title: 'ИСПУМ учится вашему стилю', body: 'Отметьте удачную лекцию кнопкой «Готово» — следующие будут писаться с оглядкой на неё: глубина заметок, формулировки, манера подачи. Берётся именно стиль, а не содержание, и только из ваших собственных отмеченных лекций.' },
      { title: 'Банк лекций кафедры', body: 'Готовую лекцию можно положить в общий банк кафедры — коллеги увидят её в разделе «Лекции кафедры» и смогут открыть, а ИСПУМ будет ориентироваться на неё при подготовке их лекций. Видно только своей кафедре и подразделениям под ней, не всему вузу; лекция коллеги открывается для просмотра.' },
      { title: 'Фирменный стиль вуза на слайдах', body: 'Администратор вуза загружает логотип и задаёт фирменный цвет — и презентации преподавателей выгружаются с логотипом на титульном листе и в цветах вуза, а не платформы. Сам титульный лист стал светлым: он дольше всех висит на проекторе, часто в освещённой аудитории, где чёрный фон читается хуже всего. Логотип вставляется в исходных пропорциях.' },
      { title: 'Тематический план можно править руками', body: 'План лекций разбирается из РПД автоматически, но в таблице Word объединённая ячейка или практика вместо лекции читаются неверно. Теперь любую строку плана можно поправить, удалить или добавить — не перезапуская разбор всей программы.' },
      { title: 'Страница написания работы — удобнее и на телефоне', body: 'Вопросы задания теперь показываются списком, каждый со своим полем, а не сплошным текстом; на телефоне кнопка отправки остаётся под рукой при прокрутке.' },
      { title: 'Задания: срок сдачи и группа списком', body: 'У задания появился срок сдачи с датой и временем. Студентов теперь можно добавить группой — вставить список по одному имени в строке — и скопировать сразу все персональные ссылки для рассылки или таблицы.' },
      { title: 'История презентаций — на всех тарифах', body: 'Созданные лекции больше не пропадают из истории на бесплатном тарифе.' },
    ],
  },
  {
    version: 'Версия 1.4',
    anchor: 'v1-4',
    month: 'Июль 2026',
    dateTime: '2026-07',
    changes: [
      { title: 'Переработка работ — с учётом прошлых замечаний', body: 'Когда студент сдаёт улучшенную версию, ИСПУМ сравнивает её с прошлой и по каждому замечанию явно отмечает: учтено, частично учтено или нет. Преподаватель сразу видит, что было сделано — без перечитывания обеих версий заново.' },
      { title: 'Тесты по материалам предмета', body: 'Соберите контрольную за минуту — от 5 до 20 вопросов с вариантами ответов и пояснениями. Три уровня сложности: запоминание, понимание, применение. Вопросы опираются на материалы вашего предмета и сопровождаются ссылками на источник, чтобы вы могли быстро проверить корректность.' },
      { title: 'Генератор тем для исследований и практик', body: 'Опишите студента — уровень обучения, направление, интересы, место практики. ИСПУМ предложит конкретные темы для ВКР, курсовых и производственной практики, грунтованные на актуальном поиске. Темы привязываются к студенту — можно вернуться к ним позже.' },
      { title: 'Привычная российская шкала 5–4–3–2', body: 'Ушли от «университетских» A–B–C–D–F: оценки выставляются по понятной для всех российской пятибалльной шкале.' },
      { title: 'Кафедра «под ключ» — массовое подключение', body: <>Приглашайте десятки преподавателей одним списком или автоматически по корпоративному домену (<code className="font-mono text-[13px]">@university.ru</code>). Все приглашённые получают полный Pro-доступ сразу, а действия администраторов фиксируются в журнале.</> },
      { title: 'Редактирование пунктов перед утверждением', body: 'Прежде чем подтвердить оценку, преподаватель может править, удалять и добавлять пункты «сильные стороны» и «что улучшить» — именно отредактированные пункты будут проверены при следующей версии работы.' },
      { title: 'ВКР-разбор с цитатами', body: 'Каждый плюс и каждое замечание в разборе подкреплены точной цитатой из работы — видно, на чём основан вывод. В начале отчёта появился блок «Что проверено»: где материала хватило для уверенного суждения, а где стоит обратить внимание самостоятельно.' },
      { title: 'Поиск противоречий в данных ВКР', body: 'ИСПУМ сверяет ключевые величины — плотности, температуры, размеры выборок, сроки — между разделами работы. Если одна и та же величина в одной главе указана как 850, а в другой как 920, вы получите блок «Противоречия в данных» со всеми упоминаниями и кратким описанием, что не сходится.' },
      { title: 'Замечания с приоритетом и подсказкой «что сделать»', body: <>Каждое замечание в ВКР-разборе получает уровень: <em>критично / существенно / незначительно</em> — критичные поднимаются в начало списка. Рядом — короткая метка действия: «к проверке» (найдено расхождение) или «спросить автора» (система не уверена — стоит уточнить). Под пунктом — одна фраза, что именно сделать: «пересчитать с учётом плотности 850, а не 920».</> },
      { title: 'Независимый перерасчёт численных результатов', body: <>Для расчётных ВКР ИСПУМ запускает отдельную модель-рассуждателя, которая самостоятельно перепроверяет головные численные результаты — по тем же входным данным и формулам, что приведены в работе. Если расхождение существенное, в отчёте появится блок «Перерасчёт результатов»: значение из работы и значение перепроверки бок о бок, плюс короткое объяснение, что именно не сошлось. Заодно проверяется применимость формул (например, Дитуса-Болтера при Re &gt; 10⁴) — выход за область применимости попадёт в замечания.</> },
    ],
  },
  {
    version: 'Версия 1.3',
    anchor: 'v1-3',
    month: 'Июнь 2026',
    dateTime: '2026-06',
    changes: [
      { title: 'Рецензирование больших работ (ВКР и дипломы)', body: 'Загрузите объёмную работу — ИСПУМ разберёт её по разделам, отметит сильные стороны и замечания и предложит вопросы к защите.' },
      { title: 'Журнал проверок', body: 'Все проверенные работы в одном месте: поиск по студенту и группе, фильтры и быстрый доступ к любой прошлой оценке.' },
      { title: 'Командная работа для кафедр и вузов', body: 'Приглашайте преподавателей, делитесь общими рубриками и отслеживайте активность — в единой панели администратора.' },
      { title: 'Экспорт оценок', body: 'Выгрузка результатов в CSV, совместимую с Moodle.' },
    ],
  },
  {
    version: 'Версия 1.2',
    anchor: 'v1-2',
    month: 'Апрель 2026',
    dateTime: '2026-04',
    changes: [
      { title: 'Проверка расчётных задач', body: 'Физика, математика, инженерия — ИСПУМ пошагово пересчитывает решение, проверяет формулы, размерности и единицы измерения.' },
      { title: 'Загрузка документов', body: 'PDF, Word и сканы — текст распознаётся автоматически, включая рукописный (OCR).' },
      { title: 'ИСПУМ учится на ваших оценках', body: 'Чем больше работ вы проверяете, тем точнее рекомендации под ваш стиль (технология RAG).' },
      { title: 'Письма с отзывами', body: 'Готовый черновик письма студенту — в один клик.' },
    ],
  },
  {
    version: 'Версия 1.1',
    anchor: 'v1-1',
    month: 'Февраль 2026',
    dateTime: '2026-02',
    changes: [
      { title: 'Генератор лекций', body: 'Структура презентации по теме и уровню аудитории — с тезисами и заметками для докладчика, готовая к переносу в PowerPoint.' },
      { title: 'Конструктор рубрик', body: 'Критерии с весами в процентах — оценка строго по вашим правилам.' },
      { title: 'Аналитика успеваемости', body: 'Профиль каждого студента и динамика его оценок по времени.' },
    ],
  },
  {
    version: 'Версия 1.0 (Public Beta)',
    anchor: 'v1-0',
    month: 'Декабрь 2025',
    dateTime: '2025-12',
    changes: [
      { title: 'Публичный запуск', body: 'Платформа ИСПУМ открыта для регистрации первых пользователей.' },
      { title: 'Проверка работ', body: 'Оценка с разбором по критериям и развёрнутой обратной связью.' },
      { title: 'Человек всегда решает', body: 'Архитектура Human-in-the-loop: ИСПУМ готовит черновик, преподаватель проверяет и утверждает.' },
    ],
  },
]

// How many changes an older release shows before «показать ещё», and the point
// below which collapsing isn't worth a click — hiding one entry behind
// «показать ещё 1» costs the reader more than it saves. The newest release is
// always fully expanded: it's what the page exists to announce.
const COLLAPSED_COUNT = 3
const MIN_HIDDEN = 3

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className="divide-y divide-border">
      {changes.map((c) => (
        <li key={c.title} className="py-4 first:pt-0 last:pb-0">
          <h3 className="text-[15px] font-semibold text-ink mb-1.5">{c.title}</h3>
          <p className="text-[15px] leading-[1.65] text-ink-secondary">{c.body}</p>
        </li>
      ))}
    </ul>
  )
}

function ReleaseSection({ release, latest }: { release: Release; latest: boolean }) {
  const [expanded, setExpanded] = useState(latest)
  const hidden = release.changes.length - COLLAPSED_COUNT
  const collapsible = !latest && hidden >= MIN_HIDDEN
  const shown = collapsible && !expanded ? release.changes.slice(0, COLLAPSED_COUNT) : release.changes

  return (
    <section id={release.anchor} className="relative pl-8 sm:pl-12 pb-14 scroll-mt-8">
      {/* Rail + node. The rail is drawn per section so the last one can stop at
          its own height instead of trailing off under the footer. */}
      <span aria-hidden className="absolute left-[7px] top-3 bottom-0 w-px bg-border" />
      <span
        aria-hidden
        className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-[3px] border-bg ${
          latest ? 'bg-amber' : 'bg-border-strong'
        }`}
      />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
        <h2 className="font-display text-2xl font-bold tracking-tight">{release.version}</h2>
        {latest && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-amber px-2 py-0.5 rounded bg-amber-light/25">
            Новое
          </span>
        )}
      </div>
      <time dateTime={release.dateTime} className="block text-sm text-ink-tertiary mb-5">
        {release.month} · {release.changes.length}{' '}
        {plural(release.changes.length, 'изменение', 'изменения', 'изменений')}
      </time>

      <div className="bg-surface border border-border rounded-xl p-5 sm:p-6 shadow-sm">
        <ChangeList changes={shown} />

        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-4 -mb-1 flex items-center min-h-[44px] text-sm font-medium text-amber hover:text-ink transition-colors"
          >
            {expanded ? 'Свернуть' : `Показать ещё ${hidden}`}
          </button>
        )}
      </div>
    </section>
  )
}

export default function Changelog() {
  const [active, setActive] = useState(RELEASES[0].anchor)

  // Highlight the version the reader is currently in. A rAF-throttled scroll
  // read rather than an IntersectionObserver: with six sections the cost is the
  // same, and this stays correct when the page is restored mid-scroll (back
  // button, refresh at an anchor), where an observer only reports once
  // something crosses the line.
  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('main section[id]'))
    if (!sections.length) return
    let frame = 0
    const read = () => {
      frame = 0
      // The section owning the trigger line at a third of the viewport: the
      // last one whose top has passed it, falling back to the first.
      const line = window.innerHeight / 3
      let current = sections[0].id
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) current = s.id
      }
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[1000px] mx-auto w-full px-4 sm:px-6 py-14 md:py-20">
        <header className="mb-14 md:mb-16">
          <h1 className="font-display text-4xl font-bold mb-3">Обновления платформы</h1>
          <p className="text-ink-secondary max-w-[62ch] leading-relaxed">
            Мы постоянно улучшаем ИСПУМ, чтобы сэкономить ваше время. Здесь вы найдёте историю
            последних изменений и новых функций.
          </p>
        </header>

        <div className="flex gap-12">
          {/* Version index — a jump list, and the reader's «you are here». Below
              `lg` it's dropped rather than restyled: the releases are already in
              order, and a second nav would crowd the reading column. */}
          <nav aria-label="Версии" className="hidden lg:block w-[168px] shrink-0">
            <ul className="sticky top-8 space-y-1 border-l border-border">
              {RELEASES.map((r) => (
                <li key={r.anchor}>
                  <a
                    href={`#${r.anchor}`}
                    aria-current={active === r.anchor ? 'true' : undefined}
                    className={`block -ml-px border-l-2 pl-4 py-1.5 text-sm transition-colors ${
                      active === r.anchor
                        ? 'border-amber text-ink font-medium'
                        : 'border-transparent text-ink-secondary hover:text-ink hover:border-border-strong'
                    }`}
                  >
                    {r.version.replace('Версия ', '')}
                    <span className="block text-xs text-ink-tertiary font-normal">{r.month}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* ~75 characters per line at 15px once the card's padding is taken
              off — the top of the 65-75 reading measure. The old zig-zag
              timeline gave each card half of an 800px container, i.e. ~40
              characters, and made the eye cross the page between entries. */}
          <div className="min-w-0 flex-1 max-w-[620px]">
            {RELEASES.map((r, i) => (
              <ReleaseSection key={r.anchor} release={r} latest={i === 0} />
            ))}
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
