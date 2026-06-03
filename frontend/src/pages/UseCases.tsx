import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function UseCases() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">
        {/* Header */}
        <section className="max-w-[800px] mx-auto px-6 pt-16 md:pt-24 pb-16 text-center">
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-6">
            Кто использует GradeAssist?
          </h1>
          <p className="text-lg text-ink-secondary leading-relaxed max-w-[600px] mx-auto">
            Наша платформа гибко адаптируется под любые образовательные задачи: от частных уроков до массовых проверок на уровне всего университета.
          </p>
        </section>

        {/* Use Case 1: Universities */}
        <section className="py-20 bg-surface-warm border-y border-border">
          <div className="max-w-[1000px] mx-auto px-6 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6 text-left">
              <div className="inline-block px-3 py-1 bg-amber-light/20 text-amber font-bold text-xs uppercase tracking-wider rounded-md">Университеты</div>
              <h2 className="font-display text-3xl font-bold text-ink">Стандартизация потока</h2>
              <p className="text-ink-secondary leading-relaxed">
                Когда на курсе учится 200 студентов, а работы проверяют три разных ассистента, сложно сохранить объективность. GradeAssist (на тарифе "Институт") позволяет заведующему кафедрой создать <strong>единую рубрику</strong>, которая гарантирует, что каждый студент будет оценен по одним и тем же жестким критериям, независимо от того, кто именно из преподавателей проверяет работу.
              </p>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li className="flex gap-2"><span>•</span> Общие стандарты для всех ассистентов</li>
                <li className="flex gap-2"><span>•</span> Аналитика слабых мест по всему потоку</li>
                <li className="flex gap-2"><span>•</span> Экономия сотен часов в сессию</li>
              </ul>
              <div className="pt-4">
                <Link to="/institutions" className="font-medium text-amber hover:text-amber/80 transition-colors flex items-center gap-2">
                  Подробнее про тариф Институт <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
            
            <div className="w-full md:w-[45%] aspect-square bg-bg border border-border rounded-2xl flex items-center justify-center p-8 shadow-sm">
              <div className="w-full h-full border border-border-mid rounded-xl bg-surface-warm/50 flex flex-col p-4">
                <div className="flex gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-border-mid"></div>
                  <div className="w-2 h-2 rounded-full bg-border-mid"></div>
                  <div className="w-2 h-2 rounded-full bg-border-mid"></div>
                </div>
                <div className="flex-1 flex flex-col gap-3">
                  <div className="h-6 w-3/4 bg-amber/20 rounded-md"></div>
                  <div className="h-24 w-full bg-bg border border-border rounded-md mt-2 flex p-3 gap-3">
                     <div className="w-12 h-12 bg-amber/10 rounded"></div>
                     <div className="flex-1 space-y-2">
                       <div className="h-3 w-full bg-border-light rounded"></div>
                       <div className="h-3 w-5/6 bg-border-light rounded"></div>
                       <div className="h-3 w-4/6 bg-border-light rounded"></div>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 2: Tutors */}
        <section className="py-20">
          <div className="max-w-[1000px] mx-auto px-6 flex flex-col md:flex-row-reverse items-center gap-12">
            <div className="flex-1 space-y-6 text-left">
              <div className="inline-block px-3 py-1 bg-amber-light/20 text-amber font-bold text-xs uppercase tracking-wider rounded-md">Частные репетиторы</div>
              <h2 className="font-display text-3xl font-bold text-ink">Быстрая обратная связь (ОГЭ/ЕГЭ)</h2>
              <p className="text-ink-secondary leading-relaxed">
                При подготовке к государственным экзаменам ключевую роль играет количество написанных эссе. С GradeAssist репетитор может задавать ученикам писать по 3-4 эссе в неделю, не сгорая на их проверке. ИИ мгновенно находит стилистические ошибки и проверяет структуру по жестким критериям ФИПИ.
              </p>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li className="flex gap-2"><span>•</span> Моментальный черновик разбора работы</li>
                <li className="flex gap-2"><span>•</span> Загрузка пользовательских критериев ЕГЭ</li>
                <li className="flex gap-2"><span>•</span> Сохранение истории прогресса ученика</li>
              </ul>
              <div className="pt-4">
                <Link to="/register" className="font-medium text-amber hover:text-amber/80 transition-colors flex items-center gap-2">
                  Попробовать бесплатно <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
            
            <div className="w-full md:w-[45%] aspect-square bg-surface-warm border border-border rounded-2xl flex items-center justify-center p-8 shadow-sm">
               <div className="w-full h-full flex flex-col gap-4">
                  <div className="h-1/3 w-full bg-bg border border-border rounded-xl flex items-center px-6 gap-4">
                     <div className="w-10 h-10 rounded-full bg-amber text-white flex items-center justify-center font-bold">5</div>
                     <div className="flex-1">
                        <div className="h-3 w-24 bg-ink/20 rounded mb-2"></div>
                        <div className="h-2 w-32 bg-ink/10 rounded"></div>
                     </div>
                  </div>
                  <div className="h-1/3 w-full bg-bg border border-border rounded-xl flex items-center px-6 gap-4 translate-x-4 opacity-75">
                     <div className="w-10 h-10 rounded-full bg-border-mid text-ink-secondary flex items-center justify-center font-bold">4</div>
                     <div className="flex-1">
                        <div className="h-3 w-24 bg-ink/20 rounded mb-2"></div>
                        <div className="h-2 w-32 bg-ink/10 rounded"></div>
                     </div>
                  </div>
                  <div className="h-1/3 w-full bg-bg border border-border rounded-xl flex items-center px-6 gap-4 translate-x-8 opacity-50">
                     <div className="w-10 h-10 rounded-full bg-border-mid text-ink-secondary flex items-center justify-center font-bold">3</div>
                     <div className="flex-1">
                        <div className="h-3 w-24 bg-ink/20 rounded mb-2"></div>
                        <div className="h-2 w-32 bg-ink/10 rounded"></div>
                     </div>
                  </div>
               </div>
            </div>
          </div>
        </section>

        {/* Use Case 3: High Schools */}
        <section className="py-20 bg-surface-warm border-y border-border">
          <div className="max-w-[1000px] mx-auto px-6 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6 text-left">
              <div className="inline-block px-3 py-1 bg-amber-light/20 text-amber font-bold text-xs uppercase tracking-wider rounded-md">Школы</div>
              <h2 className="font-display text-3xl font-bold text-ink">Снижение нагрузки на учителей</h2>
              <p className="text-ink-secondary leading-relaxed">
                Учителя литературы и истории проводят выходные за стопками тетрадей. GradeAssist выступает в роли умного ассистента, который берет на себя самую рутинную часть работы: проверку орфографии, пунктуации и базовой логики текста, оставляя учителю творческую часть — оценку смыслов и наставничество.
              </p>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li className="flex gap-2"><span>•</span> Освобождает до 15 часов в неделю</li>
                <li className="flex gap-2"><span>•</span> Позволяет задавать больше письменных работ</li>
                <li className="flex gap-2"><span>•</span> Генерирует ободряющие отзывы для учеников</li>
              </ul>
            </div>
            
            <div className="w-full md:w-[45%] aspect-square bg-bg border border-border rounded-2xl flex items-center justify-center p-8 shadow-sm">
               <div className="w-full h-full bg-surface-warm rounded-xl border border-border p-6 flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber/10 rounded-bl-full"></div>
                  <div className="h-8 w-1/2 bg-ink/10 rounded-md mb-8"></div>
                  <div className="space-y-4 flex-1">
                     <div className="h-3 w-full bg-border-mid rounded"></div>
                     <div className="h-3 w-11/12 bg-border-mid rounded"></div>
                     <div className="h-3 w-full bg-border-mid rounded"></div>
                     <div className="h-3 w-4/5 bg-border-mid rounded"></div>
                     <div className="h-3 w-full bg-amber/20 rounded"></div>
                  </div>
               </div>
            </div>
          </div>
        </section>

      </main>

      <PublicFooter />
    </div>
  )
}
