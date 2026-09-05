// CLI for the presentation generation quality eval (TODO.md Feature AG
// Phase 3) — a developer check that a prompt change to presentations.ts
// actually helped, before trusting it. Runs real generation calls (real
// LLM + Yandex Images cost) against a fixed topic set and prints objective
// metrics: speaking-notes depth, image coverage, bullets-share, citation
// coverage.
//
// Usage (from backend/):
//   npm run eval:presentations -- --teacher <uuid> [--course <uuid>] [--depth deep]
//
// Without --course, every topic runs course-less (Phase 3's web-search
// grounding kicks in instead of RAG) — pass --course to also see the
// RAG-grounded citation-coverage numbers on a course that actually has
// ingested material.

import { runPresentationEval, type EvalTopic } from '../src/services/presentationEvalHarness'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

// A deliberately mixed set — some clearly image-heavy/engineering, some
// purely conceptual/humanities-flavoured — so image-coverage and
// bullets-share numbers reflect real variety, not one topic's quirks.
const DEFAULT_TOPICS = [
  'Центробежные насосы: устройство и принцип действия',
  'Теплообменники кожухотрубного типа',
  'Основы объектно-ориентированного программирования',
  'Правовые основы предпринимательской деятельности в РФ',
  'Термодинамические циклы тепловых двигателей',
  'Методы статистического анализа данных',
  'История развития систем автоматизированного проектирования',
  'Электрохимическая коррозия металлов и методы защиты',
]

async function main(): Promise<void> {
  const teacherId = arg('teacher')
  if (!teacherId) {
    console.error('Required: --teacher <uuid>')
    process.exit(1)
  }
  const courseId = arg('course')
  const depth = (arg('depth') === 'deep' ? 'deep' : 'standard') as 'standard' | 'deep'

  const topics: EvalTopic[] = DEFAULT_TOPICS.map((topic) => ({
    topic,
    durationMinutes: 60,
    teacherId,
    courseId,
    depth,
  }))

  console.log(`Presentation eval — ${topics.length} topics, depth=${depth}, course=${courseId ?? '(none — web-grounded)'}`)
  console.log()

  const report = await runPresentationEval(topics, (done, total) => {
    process.stdout.write(`\r  ${done}/${total}`)
  })
  console.log('\n')

  if (report.failed.length > 0) {
    console.log(`── ${report.failed.length} failed ──`)
    report.failed.forEach((f) => console.log(`  ✗ ${f.topic}: ${f.error}`))
    console.log()
  }

  console.log('── per-topic ──')
  report.scored.forEach((s) => {
    const [wMin] = s.depth === 'deep' ? [260] : [180]
    const flag = s.minNotesWordCount < wMin ? '⚠' : '✓'
    console.log(
      `  ${flag} ${s.topic}\n` +
      `      slides=${s.slideCount}  notes(avg/min)=${s.avgNotesWordCount.toFixed(0)}/${s.minNotesWordCount}` +
      `  bullets=${(s.bulletsShare * 100).toFixed(0)}%  images=${(s.imageCoverageAmongEligible * 100).toFixed(0)}%` +
      `  cited=${s.sourcesAvailable ? (s.citedSlideShare * 100).toFixed(0) + '%' : 'n/a (no sources)'}` +
      `  (${(s.durationMs / 1000).toFixed(1)}s)`
    )
  })

  console.log('\n── summary ──')
  console.log(`  avg notes/slide (avg):        ${report.summary.avgNotesWordCount.toFixed(0)} words`)
  console.log(`  avg notes/slide (worst-case):  ${report.summary.avgMinNotesWordCount.toFixed(0)} words  ← the number that actually matters`)
  console.log(`  avg bullets share:             ${(report.summary.avgBulletsShare * 100).toFixed(0)}%  (prompt asks for <33%)`)
  console.log(`  avg image coverage:            ${(report.summary.avgImageCoverage * 100).toFixed(0)}%`)
  console.log(`  avg cited-slide share:         ${(report.summary.avgCitedSlideShare * 100).toFixed(0)}%  (courses with sources only)`)

  // The other half of the picture (TODO.md "### AO" Phase 2). Everything above
  // scores freshly generated decks against structural proxies; this is what
  // teachers actually did with real ones. A run that improves the numbers
  // above while the rewrite rate climbs has improved nothing.
  if (report.live) {
    const l = report.live
    console.log('\n── live signal (last 30 days) ──')
    console.log(`  decks generated:               ${l.decks}`)
    console.log(`  decks the teacher edited:      ${l.decksWithEdits}  (${(l.editedDeckShare * 100).toFixed(0)}%)  ← lower is better`)
    console.log(`  slides edited / rewritten:     ${l.editedSlides} / ${l.regeneratedSlides}  (deleted: ${l.deletedSlides})`)
    console.log(`  decks marked «Готово»:         ${l.approvedDecks}  (${(l.approvedShare * 100).toFixed(0)}%)  ← these feed the flywheel`)
  } else {
    console.log('\n  (live signal unavailable — no database connection)')
  }

  process.exit(report.failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
