// Agentic calc verification — ground calc-mode grading in actual arithmetic
// instead of the model's unverified claim that a computation is right.
//
// Bounded to exactly ONE LLM call regardless of step count: the model
// extracts up to MAX_STEPS numbered computational steps as structured JSON
// (formula, substituted values, claimed result); everything after that is
// local, deterministic, LLM-free computation (parse → evaluate → compare).
// Mirrors the critiqueFeedback() pattern in grading.ts — one call returning
// structured verdicts, applied by a pure, unit-tested function.

import { create, all } from 'mathjs'
import { chatJSON, type CallContext } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { BulletItem, CalcStepVerdict } from '../../../shared/types'

const MAX_STEPS = 12
const SUBMISSION_EXCERPT_CHARS = 6000

interface RawCalcStep {
  step_index?:     unknown
  description?:    unknown
  formula?:        unknown
  substitution?:   unknown
  claimed_result?: unknown
}

// Isolated mathjs instance — no custom functions/units imported into scope,
// so `import()`/`createUnit()` and friends are unreachable from an
// evaluated expression string regardless of what it contains.
const math = create(all, {})

// Defense in depth ahead of math.evaluate(): constrain the string to plain
// arithmetic BEFORE it reaches the parser, regardless of what mathjs's full
// grammar could otherwise do. Digits, decimal separators, arithmetic
// operators/parens, whitespace, and a short function-name whitelist only.
const ALLOWED_FUNCTIONS = ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln', 'abs', 'pow', 'min', 'max', 'pi', 'e']
const ALLOWED_EXPRESSION_RE = new RegExp(
  `^[\\d.,+\\-*/^%()\\s]*(?:(?:${ALLOWED_FUNCTIONS.join('|')})[\\d.,+\\-*/^%()\\s]*)*$`,
  'i',
)

/** Pure — parses and evaluates a numeric expression. Returns null on anything unsafe or unparseable. */
export function evaluateExpression(expr: string): number | null {
  const trimmed = expr.trim()
  if (!trimmed || !ALLOWED_EXPRESSION_RE.test(trimmed)) return null
  try {
    const result = math.evaluate(trimmed.replace(/,/g, '.'))
    if (typeof result !== 'number' || !Number.isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

/** Pure — pulls the first numeric value out of a claimed-result string ("≈50 кН" → 50), normalising decimal comma. */
export function extractLeadingNumber(s: string): number | null {
  const m = s.match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Pure — relative-or-absolute tolerance so reasonable student rounding doesn't false-positive. */
export function numbersMatch(claimed: number, evaluated: number): boolean {
  return Math.abs(claimed - evaluated) <= Math.max(Math.abs(evaluated) * 0.01, 0.01)
}

/** Pure — builds one verdict from an already-extracted raw step. No network/DB access. */
export function buildStepVerdict(raw: RawCalcStep): CalcStepVerdict {
  const step_index     = Number.isInteger(raw.step_index) ? Number(raw.step_index) : 0
  const description    = String(raw.description ?? '').trim().slice(0, 200)
  const formula        = typeof raw.formula === 'string' && raw.formula.trim() ? raw.formula.trim().slice(0, 200) : null
  const substitution   = typeof raw.substitution === 'string' && raw.substitution.trim() ? raw.substitution.trim() : null
  const claimed_result  = String(raw.claimed_result ?? '').trim().slice(0, 200)

  const evaluated = substitution ? evaluateExpression(substitution) : null
  const claimedNum = claimed_result ? extractLeadingNumber(claimed_result) : null

  let verdict: CalcStepVerdict['verdict'] = 'unevaluable'
  let note = 'Шаг не сводится к проверяемому арифметическому выражению.'
  if (evaluated != null && claimedNum != null) {
    if (numbersMatch(claimedNum, evaluated)) {
      verdict = 'correct'
      note = 'Независимый пересчёт совпадает с заявленным результатом.'
    } else {
      verdict = 'arithmetic_error'
      note = `Заявлено ${claimedNum}, при независимом пересчёте получено ${round(evaluated)}.`
    }
  }

  return {
    step_index, description, formula, substitution,
    claimed_result, evaluated_result: evaluated, verdict, note,
  }
}

export async function verifyCalculation(params: {
  submissionText:     string
  referenceSolution?: string
  assignmentContext?: string
  context:            CallContext
  providerOverride?:  'deepseek' | 'yandex' | 'gigachat'
}): Promise<CalcStepVerdict[]> {
  try {
    const system = `Вы извлекаете численные шаги расчёта из работы студента для независимой проверки арифметики. ` +
      `Для каждого шага укажите формулу (если применима), выражение с уже подставленными числовыми значениями ` +
      `(без единиц измерения — только числа и арифметические операции) и заявленный студентом результат этого шага. ` +
      `Пропускайте шаги, которые нельзя свести к простому арифметическому выражению (интегралы, таблицы, графики) — ` +
      `не более ${MAX_STEPS} самых важных численных шагов. Отвечайте только валидным JSON.`

    const reference = params.referenceSolution?.trim()
      ? `\n## Эталонное решение\n${sanitiseForPrompt(params.referenceSolution.trim()).slice(0, 2000)}\n`
      : ''
    const context = params.assignmentContext?.trim()
      ? `\n## Условие задачи\n${sanitiseForPrompt(params.assignmentContext.trim()).slice(0, 2000)}\n`
      : ''

    const user = `${context}${reference}\n## Работа студента\n<submission>\n` +
      `${sanitiseForPrompt(params.submissionText).slice(0, SUBMISSION_EXCERPT_CHARS)}\n</submission>\n\n` +
      `Верните JSON: {"steps": [{"step_index": число, "description": краткое описание шага, ` +
      `"formula": обозначение формулы или null, "substitution": числовое выражение с подставленными значениями ` +
      `(например "1000*0.5*0.1/0.001") или null если шаг не сводится к арифметике, ` +
      `"claimed_result": заявленный студентом результат как строка}]}.`

    const result = await chatJSON<{ steps?: RawCalcStep[] }>(
      [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      'шаги расчёта',
      { context: params.context, providerOverride: params.providerOverride },
    )

    const steps = Array.isArray(result.steps) ? result.steps.slice(0, MAX_STEPS) : []
    return steps.map(buildStepVerdict)
  } catch (err) {
    logger.warn({ message: '[CalcVerifier] Verification failed, skipping', error: (err as Error).message })
    return []
  }
}

/** Pure — turns an arithmetic-error verdict into a citable improvement bullet, reusing the Tier-3 BulletItem fields. */
export function toImprovementBullet(verdict: CalcStepVerdict, submissionText: string, pageCount: number): BulletItem {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  const candidateQuote = verdict.claimed_result.trim()
  const normalisedQuote = candidateQuote.toLowerCase().replace(/\s+/g, ' ').trim()
  const quote = normalisedQuote.length >= 8 && haystack.includes(normalisedQuote)
    ? candidateQuote.slice(0, 200)
    : null

  const label = verdict.description || (verdict.formula ? `Шаг по формуле ${verdict.formula}` : `Шаг ${verdict.step_index + 1}`)
  return {
    text:        `${label}: ${verdict.note}`,
    quote,
    page:        quote && pageCount > 1 ? null : null,   // page unknown at this granularity — left null deliberately
    question:    null,
    criterion_id: null,
    severity:    'substantial',
    action:      'verify',
    correction:  verdict.note.slice(0, 240),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
