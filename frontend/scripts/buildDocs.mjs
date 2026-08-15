// frontend/scripts/buildDocs.mjs — compiles docs-site/articles/**/*.md into
// frontend/src/generated/docs/{manifest.json, content/<section>/<slug>.html}.
//
// Runs automatically before `dev` and `build` (see package.json's predev/
// prebuild hooks) so the generated output never goes stale relative to the
// markdown source. Do not hand-edit anything under src/generated/docs/ —
// edit docs-site/articles/ instead and re-run.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const CONTENT_ROOT = join(REPO_ROOT, 'docs-site')
const OUT_ROOT = join(__dirname, '..', 'src', 'generated', 'docs')

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
}

// Collects ## headings from the article currently being rendered, so
// DocsArticle can show an in-page "Содержание" table of contents without a
// second markdown pass. Reset before each marked.parse() call below — safe
// because the build script is single-threaded and strictly sequential.
let currentHeadings = []
const usedIds = new Set()
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens)
      const plain = html.replace(/<[^>]+>/g, '')
      let id = slugify(plain)
      if (usedIds.has(id)) {
        let i = 2
        while (usedIds.has(`${id}-${i}`)) i++
        id = `${id}-${i}`
      }
      usedIds.add(id)
      if (depth === 2) currentHeadings.push({ id, text: plain })
      return `<h${depth} id="${id}">${html}</h${depth}>\n`
    },
  },
})

// Deliberately hand-rolled instead of pulling in gray-matter: the frontmatter
// shape here is fixed and simple (flat string keys, one per line), so a real
// YAML parser is a dependency we don't need yet.
function parseFrontmatter(raw, filePath) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    throw new Error(`${filePath}: missing --- frontmatter block`)
  }
  const [, fmBlock, body] = match
  const fm = {}
  for (const line of fmBlock.split('\n')) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx === -1) throw new Error(`${filePath}: malformed frontmatter line: "${line}"`)
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fm[key] = value
  }
  for (const required of ['title', 'description']) {
    if (!fm[required]) throw new Error(`${filePath}: frontmatter missing required field "${required}"`)
  }
  return { fm, body }
}

function main() {
  const sections = JSON.parse(readFileSync(join(CONTENT_ROOT, 'sections.json'), 'utf8'))

  rmSync(OUT_ROOT, { recursive: true, force: true })
  mkdirSync(join(OUT_ROOT, 'content'), { recursive: true })

  const manifest = []
  let articleCount = 0

  for (const section of sections) {
    const sectionDir = join(CONTENT_ROOT, 'articles', section.slug)
    let files = []
    try {
      files = readdirSync(sectionDir).filter((f) => f.endsWith('.md'))
    } catch {
      // Section declared in sections.json but has no articles yet — fine,
      // it'll just render empty until the first article is added.
    }

    const articles = files.map((file) => {
      const slug = file.replace(/\.md$/, '')
      const raw = readFileSync(join(sectionDir, file), 'utf8')
      const { fm, body } = parseFrontmatter(raw, `docs-site/articles/${section.slug}/${file}`)
      currentHeadings = []
      usedIds.clear()
      const html = marked.parse(body)

      const contentDir = join(OUT_ROOT, 'content', section.slug)
      mkdirSync(contentDir, { recursive: true })
      writeFileSync(join(contentDir, `${slug}.html`), html, 'utf8')
      articleCount++

      return {
        slug,
        title: fm.title,
        description: fm.description,
        order: fm.order ? Number(fm.order) : 999,
        appliesTo: fm.appliesTo ?? '',
        headings: currentHeadings,
      }
    })

    articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'))

    manifest.push({
      slug: section.slug,
      title: section.title,
      description: section.description,
      articles,
    })
  }

  writeFileSync(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`[buildDocs] ${articleCount} article(s) across ${sections.length} section(s) -> ${OUT_ROOT}`)
}

main()
