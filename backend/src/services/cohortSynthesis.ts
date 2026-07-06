// Class-wide synthesis over a published assignment's graded submissions.
//
// A per-student grade answers "how did this student do"; this answers "what
// should I address in the next lecture" — aggregating recurring gaps, the
// grade spread, and standout strengths across the whole cohort. Follows the
// same map-reduce shape as curriculumAnalysis.ts / syllabusReview.ts: chunk
// large cohorts, summarise each chunk, then reduce.

import { chatJSON } from './deepseek'
import { getActiveProviderName } from './llm/registry'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { findApprovedCohortSubmissions, type CohortSubmissionRow } from '../db/queries/publishedAssignments'
import { upsertCohortSynthesis } from '../db/queries/cohortSyntheses'
import { ValidationError } from '../errors/AppError'
import type { CohortSynthesis, CohortGap, GradeLetter, BulletItem } from '../../../shared/types'

const MIN_SUBMISSIONS = 5
const CHUNK_SIZE = 20

interface ChunkSummary {
  gaps:       CohortGap[]
  strengths:  string[]
}

export async function synthesizeCohort(
  publishedAssignmentId: string,
  teacherId: string,
): Promise<CohortSynthesis> {
  const rows = await findApprovedCohortSubmissions(publishedAssignmentId, teacherId)
  if (rows.length < MIN_SUBMISSIONS) {
    throw new ValidationError(
      `Нужно минимум ${MIN_SUBMISSIONS} утверждённых работ для анализа по группе (сейчас ${rows.length}).`
    )
  }

  const scoreDistribution = buildScoreDistribution(rows)

  const chunks: CohortSubmissionRow[][] = []
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) chunks.push(rows.slice(i, i + CHUNK_SIZE))

  const context = { teacherId, feature: 'grading' as const }
  const chunkSummaries = await Promise.all(chunks.map((chunk) => summariseChunk(chunk, context)))

  const combined = chunkSummaries.length === 1
    ? chunkSummaries[0]
    : await reduceSummaries(chunkSummaries, context)

  const result: CohortSynthesis = {
    common_gaps:        combined.gaps.slice(0, 8),
    score_distribution: scoreDistribution,
    standout_strengths: combined.strengths.slice(0, 5),
    recommended_topics: combined.gaps.slice(0, 5).map((g) => g.issue),
    based_on_count:      rows.length,
    generated_at:        new Date().toISOString(),
  }

  const provider = await getActiveProviderName(context, {})
  await upsertCohortSynthesis(publishedAssignmentId, result, rows.length, provider)

  return result
}

function buildScoreDistribution(rows: CohortSubmissionRow[]): { grade: GradeLetter; count: number }[] {
  const counts = new Map<GradeLetter, number>()
  for (const r of rows) {
    const grade = r.approved_grade as GradeLetter
    counts.set(grade, (counts.get(grade) ?? 0) + 1)
  }
  const order: GradeLetter[] = ['5', '4', '3', '2']
  return order
    .filter((g) => counts.has(g))
    .map((grade) => ({ grade, count: counts.get(grade)! }))
}

async function summariseChunk(
  chunk: CohortSubmissionRow[],
  context: { teacherId: string; feature: 'grading' },
): Promise<ChunkSummary> {
  const items = chunk
    .map((r, i) => {
      const improvements = (r.approved_improvements as BulletItem[] | null) ?? []
      const points = improvements.map((b) => sanitiseForPrompt(b.text)).join('; ') || '(без замечаний)'
      return `${i + 1}. Оценка ${r.approved_grade} (${r.approved_score}/100). Замечания: ${points}`
    })
    .join('\n')

  const system = `Вы анализируете отзывы по группе студенческих работ на одно и то же задание. ` +
    `Найдите ПОВТОРЯЮЩИЕСЯ пробелы (встречающиеся минимум у 2 студентов) и общие сильные стороны. ` +
    `Отвечайте только валидным JSON.`
  const user = `## Отзывы по работам (${chunk.length} шт.)\n${items}\n\n` +
    `Верните JSON: {"gaps": [{"issue": краткая формулировка пробела на русском, "count": сколько работ его показали}], ` +
    `"strengths": [краткие формулировки общих сильных сторон]}. Сортируйте gaps по убыванию count.`

  const result = await chatJSON<{ gaps?: Array<{ issue?: string; count?: number }>; strengths?: string[] }>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'анализ по группе',
    { context },
  )

  const gaps = (result.gaps ?? [])
    .map((g) => ({ issue: String(g.issue ?? '').trim(), count: Number(g.count) || 0 }))
    .filter((g) => g.issue.length > 0)
    .sort((a, b) => b.count - a.count)

  const strengths = (result.strengths ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0)

  return { gaps, strengths }
}

/** Reduce step for cohorts >CHUNK_SIZE — merges per-chunk summaries into one. */
async function reduceSummaries(
  summaries: ChunkSummary[],
  context: { teacherId: string; feature: 'grading' },
): Promise<ChunkSummary> {
  const gapsBlock = summaries
    .flatMap((s) => s.gaps)
    .map((g) => `- ${g.issue} (встречено ${g.count} раз)`)
    .join('\n')
  const strengthsBlock = summaries
    .flatMap((s) => s.strengths)
    .map((s) => `- ${s}`)
    .join('\n')

  const system = `Объедините пробелы и сильные стороны, найденные по разным подгруппам одной большой группы студентов, ` +
    `в единый непротиворечивый список — слейте дублирующиеся формулировки, суммируя их частоту. Отвечайте только валидным JSON.`
  const user = `## Пробелы по подгруппам\n${gapsBlock}\n\n## Сильные стороны по подгруппам\n${strengthsBlock}\n\n` +
    `Верните JSON: {"gaps": [{"issue": строка, "count": суммарное число}], "strengths": [строка, ...]}. Отсортируйте gaps по убыванию count.`

  const result = await chatJSON<{ gaps?: Array<{ issue?: string; count?: number }>; strengths?: string[] }>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'объединение анализа по группе',
    { context },
  )

  const gaps = (result.gaps ?? [])
    .map((g) => ({ issue: String(g.issue ?? '').trim(), count: Number(g.count) || 0 }))
    .filter((g) => g.issue.length > 0)
    .sort((a, b) => b.count - a.count)

  const strengths = (result.strengths ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0)

  return { gaps, strengths }
}
