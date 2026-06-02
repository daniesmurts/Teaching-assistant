import { Link } from 'react-router-dom'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function Institutions() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-[800px] mx-auto px-6 pt-24 pb-20 text-center">
          <div className="text-sm font-bold text-amber uppercase tracking-wider mb-4">Для ВУЗов и Факультетов</div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-8">
            Стандартизируйте проверку. Повысьте качество образования.
          </h1>
          <p className="text-lg text-ink-secondary mb-10 leading-relaxed max-w-[600px] mx-auto">
            GradeAssist для институтов предлагает централизованное управление рубриками, углубленную аналитику успеваемости по всему потоку и выделенную поддержку для вашей кафедры.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link to="/contact" className="px-8 py-3 rounded-md bg-amber text-white font-medium hover:opacity-90 transition-opacity">
              Запросить КП
            </Link>
            <Link to="/contact" className="px-8 py-3 rounded-md border border-border-mid bg-transparent text-ink font-medium hover:bg-surface transition-colors">
              Записаться на демо
            </Link>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="bg-surface-warm py-24 border-y border-border">
          <div className="max-w-[1000px] mx-auto px-6">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-bg p-8 rounded-xl border border-border">
                <div className="w-10 h-10 rounded-full bg-amber-light/20 flex items-center justify-center text-amber font-bold text-xl mb-6">1</div>
                <h3 className="font-bold text-lg mb-3">Единые стандарты</h3>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Создавайте и распространяйте общие рубрики оценки на всю кафедру. Убедитесь, что все преподаватели оценивают работы по одним и тем же прозрачным критериям.
                </p>
              </div>
              <div className="bg-bg p-8 rounded-xl border border-border">
                <div className="w-10 h-10 rounded-full bg-amber-light/20 flex items-center justify-center text-amber font-bold text-xl mb-6">2</div>
                <h3 className="font-bold text-lg mb-3">Аналитика потока</h3>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Сводные отчеты по успеваемости целых курсов. Выявляйте системные пробелы в знаниях студентов на ранних этапах и адаптируйте учебную программу.
                </p>
              </div>
              <div className="bg-bg p-8 rounded-xl border border-border">
                <div className="w-10 h-10 rounded-full bg-amber-light/20 flex items-center justify-center text-amber font-bold text-xl mb-6">3</div>
                <h3 className="font-bold text-lg mb-3">Панель администратора</h3>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Удобное управление лицензиями преподавателей. Добавляйте и удаляйте пользователей в один клик, отслеживайте статистику использования платформы.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ROI Section */}
        <section className="py-24">
          <div className="max-w-[800px] mx-auto px-6 text-center">
            <h2 className="font-display text-3xl font-bold mb-12">Возврат инвестиций (ROI)</h2>
            <div className="flex flex-col md:flex-row items-center justify-center gap-12 text-left">
              <div className="flex-1 text-center border-r border-border md:pr-12 last:border-0 last:pr-0">
                <div className="text-5xl font-display font-bold text-amber mb-4">40%</div>
                <div className="text-sm font-medium text-ink-secondary">сокращение времени на проверку работ преподавателями</div>
              </div>
              <div className="flex-1 text-center border-r border-border md:pr-12 last:border-0 last:pr-0">
                <div className="text-5xl font-display font-bold text-amber mb-4">3x</div>
                <div className="text-sm font-medium text-ink-secondary">увеличение скорости предоставления обратной связи студентам</div>
              </div>
              <div className="flex-1 text-center last:border-0">
                <div className="text-5xl font-display font-bold text-amber mb-4">100%</div>
                <div className="text-sm font-medium text-ink-secondary">соответствие российским стандартам хранения данных</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
