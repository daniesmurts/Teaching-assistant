import type { Slide } from '../../types'
import type { LegacySlide } from './slideHtml'

// Render typed slides as plain text for clipboard / "copy all" / Word paste.
// Mirrors the server-side renderSlidesAsText so the textual artefact looks
// the same wherever it comes from. LaTeX stays as $...$ — Word and Google Docs
// don't render it, but it's the most-portable representation.

export function slidesToText(slides: Slide[], startNumber = 1): string {
  return slides
    .map((s, i) => renderOne(s, startNumber + i))
    .join('\n---\n')
}

// Plain-text rendering of pre-parsed legacy text-DSL slides — used as the
// text/plain fallback when copying from old presentations alongside the
// HTML rendering produced by slideHtml.legacySlidesToHtml.
export function legacySlidesToText(slides: LegacySlide[]): string {
  return slides
    .map((s) => {
      const out = [`Слайд ${s.number}: ${s.title}`]
      s.bullets.forEach((b) => out.push(`• ${b}`))
      if (s.notes) { out.push(''); out.push('Заметки докладчика:'); out.push(s.notes) }
      return out.join('\n')
    })
    .join('\n---\n')
}

function renderOne(s: Slide, n: number): string {
  const out: string[] = [`Слайд ${n}: ${s.title}`]

  switch (s.type) {
    case 'title':
      if (s.body.subtitle) out.push(s.body.subtitle)
      if (s.body.lecturer) out.push(s.body.lecturer)
      break
    case 'bullets':
      s.body.items.forEach((b) => out.push(`• ${b}`))
      break
    case 'concept':
      if (s.body.definition) out.push(s.body.definition)
      s.body.supporting.forEach((b) => out.push(`• ${b}`))
      break
    case 'formula':
      s.body.formulas.forEach((f) => {
        out.push(`  ${f.latex}`)
        if (f.caption) out.push(`  — ${f.caption}`)
      })
      if (s.body.explanation) out.push(s.body.explanation)
      break
    case 'comparison':
      s.body.columns.forEach((c) => {
        out.push(c.header.toUpperCase())
        c.items.forEach((it) => out.push(`  • ${it}`))
      })
      break
    case 'diagram':
      if (s.body.caption) out.push(s.body.caption)
      s.body.points.forEach((p) => out.push(`• ${p}`))
      out.push(
        s.body.image
          ? `[Изображение: ${s.body.image.source_url}]`
          : `[Подобрать изображение: «${s.body.image_query}»]`
      )
      break
    case 'discussion':
      out.push(`? ${s.body.question}`)
      s.body.prompts.forEach((p) => out.push(`  • ${p}`))
      break
    case 'summary':
      if (s.body.takeaways.length) {
        out.push('Главное:')
        s.body.takeaways.forEach((t) => out.push(`• ${t}`))
      }
      if (s.body.next_steps.length) {
        out.push('Что дальше:')
        s.body.next_steps.forEach((t) => out.push(`• ${t}`))
      }
      break
  }

  if (s.notes) {
    out.push('')
    out.push('Заметки докладчика:')
    out.push(s.notes)
  }
  return out.join('\n')
}
