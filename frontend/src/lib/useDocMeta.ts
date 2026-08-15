import { useEffect } from 'react'

const DEFAULT_TITLE = 'ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов'
const DEFAULT_DESCRIPTION =
  'ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов. Помогает преподавателям проверять студенческие работы с ИИ и готовить лекции.'

// No react-helmet in this app — /docs is the first place page-specific
// <title>/<meta description> actually matters for search ranking, so this
// is a small standalone hook rather than a new dependency for one use.
export function useDocMeta(title: string, description: string) {
  useEffect(() => {
    const fullTitle = `${title} — Документация ИСПУМ`
    document.title = fullTitle
    const meta = document.querySelector('meta[name="description"]')
    meta?.setAttribute('content', description)
    return () => {
      document.title = DEFAULT_TITLE
      meta?.setAttribute('content', DEFAULT_DESCRIPTION)
    }
  }, [title, description])
}
