// frontend/scripts/postbuildDocs.mjs — makes /docs crawlable without a full
// SSR setup. The app is a plain client-rendered SPA on Object Storage (no
// server to prerender on request), so a crawler that doesn't execute JS
// would otherwise see an empty <div id="root">.
//
// For each docs article this writes a real dist/docs/<section>/<slug>/index.html:
// the same built shell (so real browsers still boot the normal SPA and take
// over), but with a correct <title>/<meta description> for that article and
// the already-rendered article HTML inlined in a <noscript> block, so a
// non-JS fetch gets real content instead of a blank page. Also emits
// robots.txt's Sitemap line target: sitemap.xml, covering the public
// marketing routes plus every docs article.
//
// Runs automatically after `build` (see package.json's postbuild hook).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const GENERATED = join(__dirname, '..', 'src', 'generated', 'docs')
const SITE_ORIGIN = 'https://ispum.ru'

// Public marketing routes worth listing in the sitemap. Keep in sync with
// the top-level public <Route>s in src/App.tsx — there's no single source
// of truth to generate this from without parsing the router tree, and that
// indirection isn't worth it for a list this short and this rarely changed.
const STATIC_ROUTES = [
  '/', '/about', '/institutions', '/pricing', '/faq', '/contact',
  '/use-cases', '/changelog', '/research',
]

function main() {
  if (!existsSync(DIST)) {
    console.error('[postbuildDocs] dist/ not found — run `vite build` first')
    process.exit(1)
  }

  const indexHtmlPath = join(DIST, 'index.html')
  const shell = readFileSync(indexHtmlPath, 'utf8')
  const manifest = JSON.parse(readFileSync(join(GENERATED, 'manifest.json'), 'utf8'))

  const urls = [...STATIC_ROUTES]

  for (const section of manifest) {
    const sectionUrl = `/docs/${section.slug}`
    urls.push(sectionUrl)
    writeStaticPage(shell, join(DIST, 'docs', section.slug, 'index.html'), {
      title: `${section.title} — Документация ИСПУМ`,
      description: section.description,
      bodyHtml: '',
    })

    for (const article of section.articles) {
      const articleUrl = `${sectionUrl}/${article.slug}`
      urls.push(articleUrl)
      const html = readFileSync(join(GENERATED, 'content', section.slug, `${article.slug}.html`), 'utf8')
      writeStaticPage(shell, join(DIST, 'docs', section.slug, article.slug, 'index.html'), {
        title: `${article.title} — Документация ИСПУМ`,
        description: article.description,
        bodyHtml: html,
      })
    }
  }

  writeStaticPage(shell, join(DIST, 'docs', 'index.html'), {
    title: 'Документация ИСПУМ для ИТ-служб университетов',
    description: 'Интеграция (SSO, LTI, роли), безопасность и соответствие 152-ФЗ, локальное развёртывание.',
    bodyHtml: '',
  })
  urls.push('/docs')

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...new Set(urls)]
      .map((u) => `  <url><loc>${SITE_ORIGIN}${u}</loc></url>`)
      .join('\n') +
    `\n</urlset>\n`
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8')

  console.log(`[postbuildDocs] wrote ${urls.length} sitemap URL(s), including ${urls.length - STATIC_ROUTES.length} docs page(s)`)
}

function writeStaticPage(shell, outPath, { title, description, bodyHtml }) {
  let html = shell
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta name="description" content=".*?"\s*\/?>/s,
      `<meta name="description" content="${escapeHtml(description)}" />`
    )
  if (bodyHtml) {
    html = html.replace(
      '<div id="root"></div>',
      `<div id="root"></div><noscript><article>${bodyHtml}</article></noscript>`
    )
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html, 'utf8')
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

main()
