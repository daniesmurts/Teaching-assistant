export interface DocsArticleMeta {
  slug: string
  title: string
  description: string
  order: number
  appliesTo: string
}

export interface DocsSection {
  slug: string
  title: string
  description: string
  articles: DocsArticleMeta[]
}
