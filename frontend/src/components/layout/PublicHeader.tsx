import { Link } from 'react-router-dom'

export default function PublicHeader() {
  return (
    <header className="max-w-[1000px] w-full mx-auto px-6 py-6 flex items-center justify-between">
      <Link to="/" className="font-display font-bold text-xl tracking-tight hover:text-amber transition-colors shrink-0 mr-4">
        GradeAssist
      </Link>
      <div className="flex items-center gap-4 md:gap-6">
        <Link to="/about" className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors">О нас</Link>
        <Link to="/institutions" className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors hidden md:block">Для ВУЗов</Link>
        <Link to="/login" className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors">Войти</Link>
        <Link to="/register" className="px-4 py-2 rounded-md bg-amber text-white text-sm font-medium hover:opacity-90 transition-opacity">Начать бесплатно</Link>
      </div>
    </header>
  )
}
