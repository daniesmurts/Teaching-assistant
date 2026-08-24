import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { validateQuoteAgainstSource } from '../lib/citation'
import type { BrsGradeThreshold } from '../../../shared/types'

// Feature AE v1 (TODO.md "### AE") — one structured extraction pass over a
// course's resolved РПД text, pulling out the БРС (балльно-рейтинговая
// система) scheme: контрольные точки, max баллы, and итоговая-grade
// thresholds. Never writes to the DB (routes/brs.ts owns that, only after
// the teacher confirms the review screen — rule #3, AI never final). Every
// checkpoint name is verbatim-checked against the source text (rule #2) so
// the review screen can flag anything the LLM may have paraphrased instead
// of quoted.

// A real РПД's control/attestation section (§8.1) rarely runs more than a
// few thousand chars even inside a much longer document — resolveCourseText
// returns the whole resolved syllabus text, so this cap just guards against
// an unusually large upload, matching fgosExtractor.ts's rationale for its
// own MAX_TEXT_CHARS.
const MAX_TEXT_CHARS = 120000

// Best-effort hint only — the review screen always lets the teacher
// override checkpoint_type, so a false positive/negative here just changes
// the extraction's default guess, never silently commits to anything.
const MANUAL_TYPE_HINT = /посещени|активност|явк/i

export interface BrsDraftCheckpoint {
  name: string
  max_points: number
  checkpoint_type: 'graded' | 'manual'
  is_verbatim_verified: boolean
}

export interface BrsDraft {
  title?: string | null
  checkpoints: BrsDraftCheckpoint[]
  gradeThresholds: BrsGradeThreshold[]
}

interface RawExtraction {
  title?: string | null
  checkpoints?: { name?: string; max_points?: number | string }[]
  grade_thresholds?: { min_points?: number | string; max_points?: number | string; grade_label?: string }[]
}

export async function extractBrsDraft(text: string): Promise<BrsDraft> {
  const empty: BrsDraft = { title: null, checkpoints: [], gradeThresholds: [] }
  const source = (text ?? '').trim()
  if (source.length < 40) return empty

  const truncated = source.slice(0, MAX_TEXT_CHARS)

  const system =
    'Вы — методист, разбирающий текст РПД (рабочей программы дисциплины) в поисках БРС ' +
    '(балльно-рейтинговой системы). Извлекайте данные строго из текста, ничего не выдумывайте. ' +
    'Названия контрольных точек копируйте ДОСЛОВНО из текста, без перефразирования. ' +
    'Отвечайте только валидным JSON.'

  const user =
    `## Текст РПД\n${sanitiseForPrompt(truncated)}\n\n` +
    `## Задача\nНайдите раздел про балльно-рейтинговую систему (БРС) / текущий контроль / промежуточную ` +
    `аттестацию и извлеките:\n` +
    `1. "title": краткое название схемы (напр. "БРС по дисциплине"), или null если не найдено.\n` +
    `2. "checkpoints": массив контрольных точек. Для каждой: {"name" (ДОСЛОВНОЕ название точки из текста, ` +
    `напр. "КТ-1 Контрольная работа"), "max_points" (максимальный балл за эту точку, число)}.\n` +
    `3. "grade_thresholds": пороги итоговой оценки по сумме баллов. Для каждого: {"min_points", "max_points", ` +
    `"grade_label" (напр. "удовлетворительно", "хорошо", "отлично")}.\n\n` +
    `## Формат\nВерните JSON: {"title": ..., "checkpoints": [...], "grade_thresholds": [...]}. Только JSON. ` +
    `Если раздел БРС не найден — верните пустые массивы, не выдумывайте данные.`

  // No try/catch here — a failed LLM call must surface as a real error, not
  // silently produce an empty draft indistinguishable from "this РПД
  // genuinely has no БРС section" (see fgosExtractor.ts for the production
  // incident that motivated removing this pattern, 2026-07-24).
  const raw = await chatJSON<RawExtraction>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'разбор БРС',
    { maxTokens: 4000 },
  )

  const checkpoints: BrsDraftCheckpoint[] = (raw.checkpoints ?? [])
    .filter((c): c is { name: string; max_points: number | string } => !!c.name && c.max_points != null)
    .map((c) => ({
      name:                 c.name,
      max_points:           Number(c.max_points) || 0,
      checkpoint_type:      MANUAL_TYPE_HINT.test(c.name) ? 'manual' : 'graded',
      is_verbatim_verified: validateQuoteAgainstSource(c.name, source) !== null,
    }))

  const gradeThresholds: BrsGradeThreshold[] = (raw.grade_thresholds ?? [])
    .filter((t): t is { min_points: number | string; max_points: number | string; grade_label: string } =>
      t.min_points != null && t.max_points != null && !!t.grade_label)
    .map((t) => ({
      min_points:  Number(t.min_points) || 0,
      max_points:  Number(t.max_points) || 0,
      grade_label: t.grade_label,
    }))

  return {
    title: raw.title ?? null,
    checkpoints,
    gradeThresholds,
  }
}

// ─── Accrual math ───────────────────────────────────────────────────────────
// Pure, no DB access — mirrors gradeOnce's "pure function" spirit (rule #8)
// even though this isn't grading itself. Called by routes/brs.ts's ledger
// endpoints with rows already fetched from the DB.

export interface AccrualCheckpoint extends BrsDraftCheckpoint {
  id: string
}

export interface AccrualScheme {
  checkpoints: AccrualCheckpoint[]
  gradeThresholds: BrsGradeThreshold[]
}

export interface ScoredRow {
  brs_checkpoint_id: string
  approved_score: number   // 0-100, this platform's universal grading scale
}

export interface ManualRow {
  brs_checkpoint_id: string
  points: number
}

export interface CheckpointAccrual {
  checkpoint_id: string
  checkpoint_name: string
  max_points: number
  earned_points: number | null   // null = nothing recorded yet for this student/checkpoint
  raw_points: number | null      // uncapped sum, so the UI can show "24/20 (capped)"
}

export interface StudentAccrual {
  checkpoints: CheckpointAccrual[]
  total_points: number
  total_max_points: number
  final_grade_label: string | null   // null = below every threshold's minimum, or no thresholds defined
}

export function computeStudentAccrual(
  scheme: AccrualScheme,
  scoredRows: ScoredRow[],
  manualRows: ManualRow[],
): StudentAccrual {
  const checkpoints: CheckpointAccrual[] = scheme.checkpoints.map((cp) => {
    const scored = scoredRows.filter((r) => r.brs_checkpoint_id === cp.id)
    const manual = manualRows.filter((r) => r.brs_checkpoint_id === cp.id)

    if (scored.length === 0 && manual.length === 0) {
      return { checkpoint_id: cp.id, checkpoint_name: cp.name, max_points: cp.max_points, earned_points: null, raw_points: null }
    }

    // 0-100 AI/approved score rescaled onto the checkpoint's own point scale
    // — every scoring event on this platform already produces a 0-100
    // score, so this always works without a second raw-points input path.
    const fromScored = scored.reduce((sum, r) => sum + (r.approved_score / 100) * cp.max_points, 0)
    const fromManual = manual.reduce((sum, r) => sum + r.points, 0)
    const raw = fromScored + fromManual

    return {
      checkpoint_id:  cp.id,
      checkpoint_name: cp.name,
      max_points:     cp.max_points,
      earned_points:  Math.min(raw, cp.max_points),
      raw_points:     raw,
    }
  })

  const total_points     = checkpoints.reduce((s, c) => s + (c.earned_points ?? 0), 0)
  const total_max_points = checkpoints.reduce((s, c) => s + c.max_points, 0)

  const final_grade_label = resolveGradeLabel(total_points, scheme.gradeThresholds)

  return { checkpoints, total_points, total_max_points, final_grade_label }
}

function resolveGradeLabel(totalPoints: number, thresholds: BrsGradeThreshold[]): string | null {
  if (thresholds.length === 0) return null
  const inRange = thresholds.find((t) => totalPoints >= t.min_points && totalPoints <= t.max_points)
  if (inRange) return inRange.grade_label
  const sorted = thresholds.slice().sort((a, b) => b.max_points - a.max_points)
  if (totalPoints > sorted[0].max_points) return sorted[0].grade_label
  return null   // below every threshold's minimum — never invent a default label
}
