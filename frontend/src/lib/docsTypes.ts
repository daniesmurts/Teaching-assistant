export interface DocsHeading {
  id: string
  text: string
}

export interface DocsArticleMeta {
  slug: string
  title: string
  description: string
  order: number
  appliesTo: string
  headings: DocsHeading[]
}

export interface DocsSection {
  slug: string
  title: string
  description: string
  articles: DocsArticleMeta[]
}
