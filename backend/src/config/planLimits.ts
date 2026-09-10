// Single source of truth for plan feature gates and usage limits.
// Never hardcode limit values in routes, services, or components — always import from here.

export const PLAN_LIMITS = {
  free: {
    gradesPerMonth:        20,
    topicsPerMonth:        3,
    quizzesPerMonth:       3,
    tasksPerMonth:         3,
    presentationsPerMonth: 3,
    criteriaImprovePerMonth: 5,
    maxCourses:            3,
    maxCriteria:           15,
    maxRubrics:            5,
    documentUpload:        false,
    ragFlywheel:           false,
    confidenceCheck:       false,
    emailGeneration:       false,
    verificationQuestions: false,
    handout:               false,
    publishedAssignments:  false,   // §5.1 process-of-creation attestation — Pro/Institution
    historyDays:           30,
    // Was false, which meant a free teacher's generated decks vanished from
    // their history — a churn mechanism rather than a paywall (TODO.md "### AO"
    // Phase 4). Losing work you made is not an upsell; depth, PPTX export and
    // the style flywheel are the paid lines here.
    presentationHistory:   true,
    watermark:             true,
    feedbackCritic:        false,
    evidenceFirst:         false,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       false,
    calcVerification:      false,
    citationCheck:         false,
    challengeFeedback:     false,
    fosGenerator:          false,
    rpdMonitor:            false,
    brsEngine:             false,   // Feature AE v1 — БРС semester ledger — Pro/Institution
    pptxExport:            false,   // Feature D — real PowerPoint export
    umcDashboard:          false,   // Feature V — УМЦ readiness dashboard, Institution only
    presentationDeepMode:  false,   // Feature AG Phase 1 — "углублённая" presentation depth
    documentLibraryInstitution: false,   // Feature AN — promote a document to institution-wide RAG scope, Institution only
    liveSessionsPerMonth:  1,
    monthlySpendCapUsd:    3,
  },
  pro: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    criteriaImprovePerMonth: Infinity,
    maxCourses:            Infinity,
    maxCriteria:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    confidenceCheck:       true,
    emailGeneration:       true,
    verificationQuestions: true,
    handout:               true,
    publishedAssignments:  true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
    feedbackCritic:        true,
    evidenceFirst:         true,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       true,
    calcVerification:      true,
    citationCheck:         true,
    challengeFeedback:     true,
    fosGenerator:          true,
    rpdMonitor:            false,
    brsEngine:             true,
    pptxExport:            true,   // Feature D — real PowerPoint export
    umcDashboard:          false,  // Feature V — Institution only, same tier as rpdMonitor
    presentationDeepMode:  true,   // Feature AG Phase 1 — "углублённая" presentation depth
    documentLibraryInstitution: false,   // Feature AN — Institution only, same tier as rpdMonitor/umcDashboard
    liveSessionsPerMonth:  Infinity,
    monthlySpendCapUsd:    30,
  },
  institution: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    criteriaImprovePerMonth: Infinity,
    maxCourses:            Infinity,
    maxCriteria:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    confidenceCheck:       true,
    emailGeneration:       true,
    verificationQuestions: true,
    handout:               true,
    publishedAssignments:  true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
    feedbackCritic:        true,
    evidenceFirst:         true,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       true,
    calcVerification:      true,
    citationCheck:         true,
    challengeFeedback:     true,
    fosGenerator:          true,
    rpdMonitor:            true,
    brsEngine:             true,
    pptxExport:            true,   // Feature D — real PowerPoint export
    umcDashboard:          true,   // Feature V — УМЦ readiness dashboard
    presentationDeepMode:  true,   // Feature AG Phase 1 — "углублённая" presentation depth
    documentLibraryInstitution: true,   // Feature AN — promote a document to institution-wide RAG scope
    liveSessionsPerMonth:  Infinity,
    monthlySpendCapUsd:    150,
  },
} as const

export type PlanTier   = keyof typeof PLAN_LIMITS
export type PlanLimits = typeof PLAN_LIMITS[PlanTier]

export function getLimits(tier: string): PlanLimits {
  return PLAN_LIMITS[tier as PlanTier] ?? PLAN_LIMITS.free
}

export function canUseFeature(
  tier: string,
  feature: keyof PlanLimits
): boolean {
  return Boolean(getLimits(tier)[feature])
}

// ─── DeepSeek pricing (update if rates change) ────────────────────────────────
//
// Confirmed 2026-09-10 against api-docs.deepseek.com/quick_start/pricing and
// /guides/reasoning_model.
//
// **V4.1-Flash (`deepseek-flash`) is the only DeepSeek model still served.**
// Every V4-era id is now an accepted alias routing to it — `deepseek-v4-flash`
// and `deepseek-v4-flash-vision-exp` already, `deepseek-v4-pro` from
// 2026-09-14 04:00 UTC (12:00 Beijing) per DeepSeek's own retirement notice.
// Whichever id we send, the invoice is Flash's, so the split below is about
// *when* a call happened, not which weights ran.
//
// Two things this fixes, both of which were mis-costing rows silently:
//   • V4.1-Flash raised output pricing far above V4-Flash's ($0.28 → $1.20 per
//     1M at peak). Since `deepseek-v4-flash` has been an alias onto it, every
//     bulk grading/presentation/quiz call has been under-logged on output.
//   • Peak vs off-peak is a flat 2× swing, previously not modelled at all.
//     Too large to average away, and free to get right: cost is computed at
//     request time at all three call sites in `llm/deepseek.ts`, so the call's
//     own timestamp is the correct rate key.
//
// Still NOT modelled: cache-hit input, ~50× cheaper than cache-miss ($0.006 vs
// $0.30 per 1M at peak). Cached prompts are over-costed — the conservative
// direction, and the same simplification `calculateQwenCost` makes for Qwen's
// context tiers.
interface DeepSeekRate { in: number; out: number }

// PEAK rates, USD per 1M tokens. Off-peak is exactly half, applied in
// calculateDeepSeekCost rather than duplicated as a second table.
const FLASH_RATE: DeepSeekRate = { in: 0.30, out: 1.20 }

// deepseek-v4-pro's own published rate, charged only until the cutover below.
// Both this and PRO_RETIREMENT_UTC are safe to delete once no traffic being
// costed can predate 2026-09-14 — i.e. as soon as that date is comfortably
// past; they exist because this landed days before it.
const PRO_RATE: DeepSeekRate = { in: 1.32, out: 3.96 }
const PRO_RETIREMENT_UTC = Date.UTC(2026, 8, 14, 4, 0, 0)

// Retired V3-era ids. Flat, and deliberately OUTSIDE the peak/off-peak
// multiplier: nothing has sent them since the V4 migration, so they only ever
// answer a lookup for an id resurrected by an old override or a replayed eval,
// and reinterpreting their long-settled numbers would be noise. (Rows already
// written keep the cost_usd they were stored with — usageLog persists cost per
// row at write time, so none of this changes history.)
const LEGACY_RATES: Record<string, DeepSeekRate> = {
  'deepseek-chat':     { in: 0.14, out: 0.28 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
}

/** Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Everything else —
 *  evenings, nights, whole weekends — is off-peak at half price. */
export function isDeepSeekPeakHour(at: Date): boolean {
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

export function calculateDeepSeekCost(
  inputTokens: number,
  outputTokens: number,
  model = 'deepseek-flash',
  at: Date = new Date(),
): number {
  const legacy = LEGACY_RATES[model]
  if (legacy) {
    return (inputTokens / 1_000_000) * legacy.in + (outputTokens / 1_000_000) * legacy.out
  }

  const rate = model === 'deepseek-v4-pro' && at.getTime() < PRO_RETIREMENT_UTC
    ? PRO_RATE
    : FLASH_RATE
  const peakMultiplier = isDeepSeekPeakHour(at) ? 1 : 0.5

  return ((inputTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out) * peakMultiplier
}

// ─── Qwen3 pricing (DashScope compatible-mode rates) ──────────────────────────
// USD per 1M tokens. Confirmed against DashScope's console pricing page
// (2026-07-11) — standard international tier, 0–256K context for Plus /
// 0–1M for Max. Plus steps up to $1.20 in / $4.80 out per 1M above 256K
// context, not modelled here (flat single-tier rate, same simplification
// DeepSeek's calculator already makes for its own cache-hit discount tier);
// underprices the rare submission whose prompt crosses 256K tokens. Ignores
// the temporary 20% Plus discount (input only, expires 2026-07-23) since a
// promo rate would go stale within days of landing.
const QWEN_RATES: Record<string, { in: number; out: number }> = {
  'qwen3.7-plus': { in: 0.40, out: 1.60 },
  'qwen3.7-max':  { in: 2.50, out: 7.50 },
}

export function calculateQwenCost(inputTokens: number, outputTokens: number, model = 'qwen3.7-plus'): number {
  const r = QWEN_RATES[model] ?? QWEN_RATES['qwen3.7-plus']
  return (inputTokens / 1_000_000) * r.in + (outputTokens / 1_000_000) * r.out
}

// ─── Yandex Cloud pricing ──────────────────────────────────────────────────
//
// Confirmed 2026-07-30 against real Yandex AI Studio pricing sources
// (console pricing tables + the AI Studio pricing assistant, both supplied
// directly by the user — TODO.md Improvement #13). Same "update if rates
// change" posture as DeepSeek/Qwen above; override via the env vars below
// if a rate changes.
//
// - **Chat** (₽, converted via services/fxRate.ts like everything else in
//   this section): the console lists two text-generation tiers — "Alice AI
//   LLM Flash" (cheap) and plain "Alice AI LLM" (the bigger model), each
//   split sync/async/cached/tool-token. `CHAT_MODEL = 'yandexgpt'` in
//   `llm/yandex.ts` — no `-lite` suffix — is the pre-rebrand model-URI
//   naming for the STANDARD/PRO tier, not the lite one; mapped to the
//   non-Flash "Alice AI LLM" row. Our call is a single POST with no
//   operation polling (`completionOptions.stream: false`), so synchronous
//   pricing applies: 0.5₽/1000 in, 1.2₽/1000 out → 500/1200 ₽ per 1M tokens.
// - **Vision OCR** (₽): "Распознавание печатного текста" (0.1321₽/image) is
//   the plain-text-detection product — matches `TEXT_DETECTION` in
//   `yandexVision.ts`'s `batchAnalyze` call. The passport/CTC/vehicle-plate/
//   handwriting rows in the same table are unrelated document-specific OCR
//   products, not used here.
// - **Search — two DIFFERENT products, not one** (₽). `yandexImages.ts`
//   calls the SYNCHRONOUS `/v2/image/search` endpoint → "Поиск изображений"
//   (915₽/1000 ops = 0.915₽/call). `yandexSearch.ts`'s `webSearch` submits
//   to `/v2/web/searchAsync` and polls — the ASYNC ("отложенные") row, not
//   sync — priced separately, day vs night; using the daytime (higher, more
//   conservative) rate since our calls aren't time-gated: 30.5₽/1000 ops =
//   0.0305₽/call. These two were previously conflated into one
//   `searchPerCall` constant despite being ~30× apart — a real
//   understatement for every image search logged before this fix.
// - **Embeddings** (₽, VAT-inclusive): "Получение эмбеддингов текста" —
//   0.0101₽ per 1000 tokens (1 token = 1 vectorization unit) → 10.1₽ per 1M
//   tokens, from the same static console pricing table as chat/vision/search
//   (superseding an earlier USD-denominated figure from the AI Studio
//   pricing *assistant* — the static table is the more authoritative
//   source, and having every Yandex product on the same ₽/FX basis avoids a
//   mixed-currency inconsistency for no reason). Note this table explicitly
//   says "вкл. НДС" (VAT-inclusive); the other three tables didn't disclose
//   their VAT basis, so full cross-product consistency isn't guaranteed —
//   good enough for cost tracking, not a reconciled invoice.
export interface YandexRatesRub {
  chatInPerM:         number   // ₽ per 1M input tokens — Alice AI LLM (non-Flash), synchronous
  chatOutPerM:        number   // ₽ per 1M output tokens — Alice AI LLM (non-Flash), synchronous
  embedPerM:          number   // ₽ per 1M tokens — "Получение эмбеддингов текста", VAT-inclusive
  visionPerPage:      number   // ₽ per OCR page — "Распознавание печатного текста"
  webSearchPerCall:   number   // ₽ per web search call — async/"отложенные", daytime rate
  imageSearchPerCall: number   // ₽ per image search call — sync, "Поиск изображений"
}

const YANDEX_DEFAULT_RATES_RUB: YandexRatesRub = {
  chatInPerM:         500,
  chatOutPerM:        1200,
  embedPerM:          10.1,
  visionPerPage:      0.1321,
  webSearchPerCall:   0.0305,
  imageSearchPerCall: 0.915,
}

function envRateNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function getYandexRatesRub(): YandexRatesRub {
  return {
    chatInPerM:         envRateNumber('YANDEX_RATE_CHAT_IN_RUB_PER_M',         YANDEX_DEFAULT_RATES_RUB.chatInPerM),
    chatOutPerM:        envRateNumber('YANDEX_RATE_CHAT_OUT_RUB_PER_M',        YANDEX_DEFAULT_RATES_RUB.chatOutPerM),
    embedPerM:          envRateNumber('YANDEX_RATE_EMBED_RUB_PER_M',           YANDEX_DEFAULT_RATES_RUB.embedPerM),
    visionPerPage:      envRateNumber('YANDEX_RATE_VISION_RUB_PER_PAGE',       YANDEX_DEFAULT_RATES_RUB.visionPerPage),
    webSearchPerCall:   envRateNumber('YANDEX_RATE_WEB_SEARCH_RUB_PER_CALL',   YANDEX_DEFAULT_RATES_RUB.webSearchPerCall),
    imageSearchPerCall: envRateNumber('YANDEX_RATE_IMAGE_SEARCH_RUB_PER_CALL', YANDEX_DEFAULT_RATES_RUB.imageSearchPerCall),
  }
}

export function calculateYandexChatCostRub(inputTokens: number, outputTokens: number): number {
  const r = getYandexRatesRub()
  return (inputTokens / 1_000_000) * r.chatInPerM + (outputTokens / 1_000_000) * r.chatOutPerM
}

export function calculateYandexEmbedCostRub(tokens: number): number {
  return (tokens / 1_000_000) * getYandexRatesRub().embedPerM
}

export function calculateYandexVisionCostRub(pages: number): number {
  return pages * getYandexRatesRub().visionPerPage
}

export function calculateYandexWebSearchCostRub(calls = 1): number {
  return calls * getYandexRatesRub().webSearchPerCall
}

export function calculateYandexImageSearchCostRub(calls = 1): number {
  return calls * getYandexRatesRub().imageSearchPerCall
}
