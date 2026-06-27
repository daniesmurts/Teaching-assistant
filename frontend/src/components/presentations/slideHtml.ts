import type { Slide } from '../../types'

// HTML rendering of typed slides for the clipboard. Paste targets
// (PowerPoint, Word, Google Slides / Docs) honour `text/html` and:
//   • download <img src> and embed the bytes — this is why "copy slide" now
//     actually carries the image into the deck rather than a link to it
//   • render <ul>/<ol>/<table> as native lists / tables
//   • keep <h2>/<strong>/<em>/<sup> formatting
//
// We deliberately keep the markup minimal — no CSS, no classes — so the
// receiving app's own styles take over. Inline math ($...$ / $$...$$) is
// preserved as text rather than rendered; equation editors live in Word /
// Slides and can pick it up from there. Citation markers [N] become <sup>.

export interface LegacySlide {
  number:  number
  title:   string
  bullets: string[]
  notes:   string
}

export function slidesToHtml(slides: Slide[], startNumber = 1): string {
  const body = slides
    .map((s, i) => renderTyped(s, startNumber + i))
    .join('\n<hr />\n')
  return wrap(body)
}

export function legacySlidesToHtml(slides: LegacySlide[]): string {
  const body = slides.map(renderLegacy).join('\n<hr />\n')
  return wrap(body)
}

// HTML clipboard contents work best when wrapped in a basic document — some
// targets (notably MS Office on macOS) refuse paste otherwise. Keep <meta>
// charset so Cyrillic doesn't get mangled by the receiver's default.
function wrap(body: string): string {
  return `<html><head><meta charset="utf-8"></head><body>${body}</body></html>`
}

// ── Typed slides ─────────────────────────────────────────────────────────────

function renderTyped(s: Slide, n: number): string {
  const header = `<h2>Слайд ${n}: ${richText(s.title)}</h2>`
  let body = ''

  switch (s.type) {
    case 'title':
      body = [
        s.body.subtitle ? `<p><em>${richText(s.body.subtitle)}</em></p>` : '',
        s.body.lecturer ? `<p>${richText(s.body.lecturer)}</p>` : '',
      ].filter(Boolean).join('\n')
      break

    case 'bullets':
      body = ul(s.body.items)
      break

    case 'concept':
      body = [
        s.body.definition ? `<p><strong>${richText(s.body.definition)}</strong></p>` : '',
        ul(s.body.supporting),
      ].filter(Boolean).join('\n')
      break

    case 'formula':
      body = [
        s.body.formulas.length
          ? `<ul>${s.body.formulas.map((f) =>
              `<li><code>${escapeHtml(f.latex)}</code>${f.caption ? ` — ${richText(f.caption)}` : ''}</li>`
            ).join('')}</ul>`
          : '',
        s.body.explanation ? `<p>${richText(s.body.explanation)}</p>` : '',
      ].filter(Boolean).join('\n')
      break

    case 'comparison':
      // Native <table> — pastes as a real table in Word and Google Docs/Slides.
      body = `<table border="1" cellspacing="0" cellpadding="6">
        <thead><tr>${
          s.body.columns.map((c) => `<th>${richText(c.header)}</th>`).join('')
        }</tr></thead>
        <tbody><tr>${
          s.body.columns.map((c) =>
            `<td valign="top">${ul(c.items) || '&nbsp;'}</td>`
          ).join('')
        }</tr></tbody>
      </table>`
      break

    case 'diagram':
      // The image is the whole point of the slide — full-size URL goes in
      // first so paste targets embed it rather than the thumbnail.
      body = [
        s.body.image
          ? `<p><img src="${escapeAttr(s.body.image.url)}" alt="${escapeAttr(s.body.caption || s.title)}" /></p>`
          : `<p><em>[Подобрать изображение: «${richText(s.body.image_query)}»]</em></p>`,
        s.body.caption ? `<p><strong>${richText(s.body.caption)}</strong></p>` : '',
        ul(s.body.points),
        s.body.image
          ? `<p><small>Источник: <a href="${escapeAttr(s.body.image.source_url)}">${escapeHtml(s.body.image.source_host || s.body.image.source_url)}</a></small></p>`
          : '',
      ].filter(Boolean).join('\n')
      break

    case 'discussion':
      body = [
        s.body.question ? `<p><strong>${richText(s.body.question)}</strong></p>` : '',
        ul(s.body.prompts),
      ].filter(Boolean).join('\n')
      break

    case 'summary':
      body = [
        s.body.takeaways.length
          ? `<p><strong>Главное</strong></p>${ul(s.body.takeaways)}`
          : '',
        s.body.next_steps.length
          ? `<p><strong>Что дальше</strong></p>${ul(s.body.next_steps)}`
          : '',
      ].filter(Boolean).join('\n')
      break
  }

  const notes = s.notes
    ? `<p><strong><em>Заметки докладчика:</em></strong> ${richText(s.notes)}</p>`
    : ''

  return [header, body, notes].filter(Boolean).join('\n')
}

// ── Legacy text-DSL slides (old presentations) ───────────────────────────────

function renderLegacy(s: LegacySlide): string {
  return [
    `<h2>Слайд ${s.number}: ${richText(s.title)}</h2>`,
    ul(s.bullets),
    s.notes ? `<p><strong><em>Заметки докладчика:</em></strong> ${richText(s.notes)}</p>` : '',
  ].filter(Boolean).join('\n')
}

// ── Small helpers ────────────────────────────────────────────────────────────

function ul(items: string[]): string {
  if (!items.length) return ''
  return `<ul>${items.map((it) => `<li>${richText(it)}</li>`).join('')}</ul>`
}

// Inline text rendering — escape HTML, then turn [N] / [N, M] citation
// markers into <sup>[N]</sup>. Math delimiters ($..$ / $$..$$) are left
// in place; receivers can hand them to their own equation editor.
function richText(text: string): string {
  return escapeHtml(text).replace(/\[(\d+(?:,\s*\d+)*)\]/g, '<sup>[$1]</sup>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}
