import { Link } from 'react-router-dom'

export default function PublicFooter() {
  return (
    <footer className="max-w-[1000px] mx-auto px-6 py-12 flex flex-col items-center justify-between border-t border-border mt-auto">
      <div className="w-full flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
        <div className="text-center md:text-left">
          <div className="text-sm text-ink-secondary">
            © {new Date().getFullYear()} ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов
          </div>
          <div className="text-xs text-ink-tertiary mt-1">
            Создано для современного образования
          </div>
        </div>
        <div className="text-ink-tertiary text-xs text-center md:text-right">
          ИП Бугембе Даниел (ИНН 165510859142)<br/>
          daniel@boadtech.com | +79179040998
        </div>
      </div>
      
      <div className="flex gap-4 text-sm text-ink-tertiary flex-wrap justify-center items-center w-full">
        <Link to="/about" className="hover:text-ink cursor-pointer transition-colors">О нас</Link>
        <Link to="/pricing" className="hover:text-ink cursor-pointer transition-colors">Тарифы</Link>
        <Link to="/use-cases" className="hover:text-ink cursor-pointer transition-colors">Применение</Link>
        <Link to="/changelog" className="hover:text-ink cursor-pointer transition-colors">Обновления</Link>
        <Link to="/institutions" className="hover:text-ink cursor-pointer transition-colors">ВУЗам</Link>
        <Link to="/research" className="hover:text-ink cursor-pointer transition-colors">Исследования</Link>
        <Link to="/faq" className="hover:text-ink cursor-pointer transition-colors">FAQ</Link>
        <Link to="/ethics" className="hover:text-ink cursor-pointer transition-colors">Этика ИИ</Link>
        <Link to="/contact" className="hover:text-ink cursor-pointer transition-colors">Контакты</Link>
        
        <span className="text-border-mid hidden md:inline">|</span>
        
        <Link to="/offer" className="hover:text-ink transition-colors">Оферта</Link>
        <Link to="/privacy" className="hover:text-ink transition-colors">Конфиденциальность</Link>
        <Link to="/terms" className="hover:text-ink transition-colors">Правила</Link>
        <Link to="/cookies" className="hover:text-ink transition-colors">Cookie</Link>
        
        <span className="text-ink-inv-muted md:ml-2 md:border-l border-border md:pl-4">Работает без VPN в РФ</span>
      </div>
    </footer>
  )
}
