import { Link } from 'react-router-dom'
import { ReactNode } from 'react'
import PublicHeader from './PublicHeader'
import PublicFooter from './PublicFooter'

interface LegalLayoutProps {
  title: string
  lastUpdated: string
  children: ReactNode
}

export default function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-bg text-ink font-sans selection:bg-amber-light selection:text-ink">
      <PublicHeader />
      
      <main className="max-w-[800px] mx-auto px-6 py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-4">{title}</h1>
        <div className="text-sm text-ink-tertiary mb-10 pb-6 border-b border-border">
          Последнее обновление: {lastUpdated}
        </div>
        
        <div className="text-ink-secondary leading-relaxed space-y-6">
          {children}
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
