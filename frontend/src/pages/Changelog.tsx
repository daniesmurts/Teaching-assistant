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
          
          {/* Version 1.1 */}
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-bg bg-amber text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 8 8 8.009 8.009 0 0 0-8-8Zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" /></svg>
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface p-6 rounded-xl border border-border shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink">Версия 1.1.0</span>
                <span className="text-xs font-medium text-amber px-2 py-1 rounded bg-amber-light/20">Новое</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Октябрь 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Поддержка PDF и DOCX.</strong> Теперь вы можете загружать студенческие работы напрямую без необходимости копировать текст. ИИ автоматически распознает структуру документа.</p>
                <p><strong>Генератор лекций 2.0.</strong> Мы обновили алгоритм создания презентаций — теперь структура еще точнее соответствует вашим черновым заметкам.</p>
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
                <span className="font-bold text-ink">Версия 1.0.0 (Public Beta)</span>
              </div>
              <time className="block text-sm text-ink-secondary mb-3">Сентябрь 2026</time>
              <div className="text-sm text-ink-secondary space-y-2">
                <p><strong>Публичный запуск.</strong> Платформа ИСПУМ открыта для регистрации первых пользователей.</p>
                <p><strong>Конструктор рубрик.</strong> Полноценный инструмент для создания кастомных критериев оценки (логика, стиль, аргументация и т.д.).</p>
                <p><strong>Архитектура Human-in-the-loop.</strong> Внедрена система проверки RAG для исключения ИИ-галлюцинаций.</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
