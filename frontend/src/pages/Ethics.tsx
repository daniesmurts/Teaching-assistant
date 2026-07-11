import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'
import LegalSidebar from '../components/layout/LegalSidebar'

export default function Ethics() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[1080px] mx-auto w-full px-6 py-16 md:py-24 flex flex-col md:flex-row gap-10 md:gap-16">
        <LegalSidebar />

        <div className="min-w-0 flex-1 max-w-[760px]">
          <h1 className="font-display text-4xl font-bold mb-8">Этика ИИ и Образования</h1>

          <div className="prose prose-sm md:prose-base max-w-none text-ink-secondary space-y-6">
            <p className="lead text-lg font-medium text-ink">
              Мы верим, что искусственный интеллект не должен заменять преподавателя. Его цель — устранить рутину, чтобы преподаватель мог сосредоточиться на главном: обучении и наставничестве.
            </p>

            <h2 className="font-display text-2xl font-bold text-ink mt-12 mb-4">Подход "Human-in-the-Loop"</h2>
            <p>
              В основе архитектуры ИСПУМ лежит концепция "Человек в цикле" (Human-in-the-Loop). ИИ выступает исключительно в роли ассистента, выполняющего черновую работу: он анализирует текст, сопоставляет его с вашими критериями и предлагает структуру отзыва. <strong>Система никогда не принимает окончательных решений и не отправляет оценки студентам напрямую.</strong>
            </p>
            <p>
              Преподаватель всегда остается главным экспертом, который валидирует, редактирует или отвергает рекомендации системы.
            </p>

            <h2 className="font-display text-2xl font-bold text-ink mt-12 mb-4">Неприкосновенность студенческих данных</h2>
            <p>
              Интеллектуальная собственность студентов — это святое. Загруженные эссе, диссертации и курсовые работы <strong>не используются для дообучения базовых коммерческих LLM (Large Language Models)</strong>. Данные остаются изолированными в рамках защищенного векторного хранилища вашего аккаунта (RAG) исключительно для обеспечения контекста ваших проверок.
            </p>

            <h2 className="font-display text-2xl font-bold text-ink mt-12 mb-4">Борьба с предвзятостью (Bias)</h2>
            <p>
              ИСПУМ спроектирован так, чтобы оценивать работы исключительно на основе объективных критериев рубрики, созданной преподавателем. Система не имеет доступа к демографическим данным студентов (если они не указаны в самом тексте), что помогает снизить уровень бессознательной предвзятости при оценке.
            </p>

            <div className="mt-12 p-6 bg-surface-warm border border-border rounded-xl">
              <h3 className="font-bold text-ink mb-2">Наш Манифест</h3>
              <ul className="list-disc pl-5 space-y-2 text-sm">
                <li>Учитель всегда прав. ИИ лишь предлагает варианты.</li>
                <li>Прозрачность: вы всегда можете видеть, на основе чего ИИ сделал вывод.</li>
                <li>Приватность по умолчанию: мы храним только то, что необходимо для работы сервиса.</li>
                <li>Технологии ради образования, а не образование ради технологий.</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
