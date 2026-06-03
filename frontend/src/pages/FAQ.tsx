import { useState } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function FAQ() {
  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[800px] mx-auto w-full px-6 py-16 md:py-24">
        <h1 className="font-display text-4xl font-bold mb-4 text-center">Часто задаваемые вопросы</h1>
        <p className="text-ink-secondary text-center mb-16">
          Все, что вам нужно знать о работе с ИСПУМ.
        </p>

        <div className="space-y-4">
          <FAQItem 
            question="Обучается ли ИИ на работах моих студентов?" 
            answer="Нет. Мы категорически против использования студенческих данных для тренировки публичных моделей ИИ. Загружаемые вами работы используются только локально в рамках вашего аккаунта для генерации оценки и не передаются третьим лицам для дообучения базовых моделей."
          />
          <FAQItem 
            question="Может ли система определить текст, написанный ChatGPT?" 
            answer="В настоящее время ИСПУМ фокусируется на проверке логики, аргументации и стиля по заданным вами критериям. Встроенного детектора ИИ-текста нет, так как существующие на рынке детекторы часто дают ложноположительные результаты. Мы рекомендуем использовать ИСПУМ для глубокого анализа структуры работы."
          />
          <FAQItem 
            question="Как оплатить подписку?" 
            answer="Вы можете оплатить подписку банковской картой РФ. Для учебных заведений (тариф Институт) мы выставляем счет-договор для безналичной оплаты с предоставлением всех закрывающих документов."
          />
          <FAQItem 
            question="Что такое технология RAG и почему она важна?" 
            answer="RAG (Retrieval-Augmented Generation) — это подход, при котором нейросеть перед ответом обращается к вашей личной базе знаний (вашим прошлым оценкам и рубрикам). Это предотвращает 'галлюцинации' ИИ и заставляет его оценивать студентов именно в вашем авторском стиле, а не по усредненным шаблонам."
          />
          <FAQItem 
            question="Кто принимает окончательное решение об оценке?" 
            answer="Всегда только вы. ИСПУМ работает как ваш цифровой ассистент: он предлагает детальный разбор работы и черновик оценки. Окончательный вердикт, правки и отправка результата студенту остаются исключительно за преподавателем."
          />
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}

function FAQItem({ question, answer }: { question: string, answer: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between font-medium text-left hover:bg-surface-warm transition-colors"
      >
        <span>{question}</span>
        <span className="text-amber text-xl">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && (
        <div className="px-6 pb-4 text-ink-secondary text-sm leading-relaxed border-t border-border pt-4">
          {answer}
        </div>
      )}
    </div>
  )
}
