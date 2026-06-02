import { useState } from 'react'
import PublicHeader from '../components/layout/PublicHeader'
import PublicFooter from '../components/layout/PublicFooter'

export default function Contact() {
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    message: '',
    type: 'support' // support, demo, billing
  })
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Logic for submitting the form would go here (e.g. API call)
    setIsSubmitted(true)
  }

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-[1000px] mx-auto w-full px-6 py-16 md:py-24">
        <h1 className="font-display text-4xl font-bold mb-4 text-center">Свяжитесь с нами</h1>
        <p className="text-ink-secondary text-center mb-16 max-w-[500px] mx-auto">
          Остались вопросы или хотите запросить демо для вашего ВУЗа? Напишите нам, и мы ответим в течение рабочего дня.
        </p>

        <div className="grid md:grid-cols-2 gap-12 lg:gap-24">
          
          {/* Contact Details */}
          <div>
            <h2 className="font-display text-2xl font-bold mb-6">Контактная информация</h2>
            <div className="space-y-6 text-ink-secondary">
              <div>
                <div className="font-bold text-ink mb-1">Email</div>
                <a href="mailto:daniel@boadtech.com" className="hover:text-amber transition-colors">daniel@boadtech.com</a>
              </div>
              <div>
                <div className="font-bold text-ink mb-1">Телефон</div>
                <a href="tel:+79179040998" className="hover:text-amber transition-colors">+7 (917) 904-09-98</a>
              </div>
              <div className="pt-6 border-t border-border">
                <div className="font-bold text-ink mb-1">Реквизиты</div>
                <p className="text-sm">ИП Бугембе Даниел</p>
                <p className="text-sm">ИНН: 165510859142</p>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div>
            {isSubmitted ? (
              <div className="bg-success-bg border border-success p-8 rounded-xl text-center">
                <div className="w-12 h-12 bg-success text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">✓</div>
                <h3 className="font-bold text-lg mb-2 text-success">Сообщение отправлено!</h3>
                <p className="text-sm text-success/80">Мы получили ваш запрос и свяжемся с вами в ближайшее время.</p>
                <button 
                  onClick={() => setIsSubmitted(false)}
                  className="mt-6 text-sm font-medium text-success hover:underline"
                >
                  Отправить еще одно сообщение
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="name" className="text-sm font-medium">Ваше имя</label>
                  <input 
                    type="text" 
                    id="name" 
                    required
                    value={formState.name}
                    onChange={(e) => setFormState({...formState, name: e.target.value})}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                    placeholder="Иван Иванов"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium">Email</label>
                  <input 
                    type="email" 
                    id="email" 
                    required
                    value={formState.email}
                    onChange={(e) => setFormState({...formState, email: e.target.value})}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                    placeholder="ivan@university.edu"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="type" className="text-sm font-medium">Тема обращения</label>
                  <select 
                    id="type"
                    value={formState.type}
                    onChange={(e) => setFormState({...formState, type: e.target.value})}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm"
                  >
                    <option value="support">Вопрос в поддержку</option>
                    <option value="demo">Запросить демо (Для ВУЗов)</option>
                    <option value="billing">Вопросы по оплате</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="message" className="text-sm font-medium">Сообщение</label>
                  <textarea 
                    id="message" 
                    required
                    rows={4}
                    value={formState.message}
                    onChange={(e) => setFormState({...formState, message: e.target.value})}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber text-sm resize-none"
                    placeholder="Как мы можем вам помочь?"
                  />
                </div>

                <button 
                  type="submit" 
                  className="w-full bg-amber hover:bg-amber/90 text-white font-medium py-2.5 rounded-md transition-colors"
                >
                  Отправить
                </button>
                <p className="text-xs text-ink-tertiary text-center mt-2">
                  Нажимая кнопку «Отправить», вы соглашаетесь с <a href="/privacy" className="underline hover:text-ink">политикой конфиденциальности</a>.
                </p>
              </form>
            )}
          </div>

        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
