// Compat shim. The actual implementations moved to services/llm/* in Phase 4.
// Every existing import in the codebase continues to work; new code should
// import from services/llm/registry directly.

export { chat, chatJSON, embed } from './llm/registry'
export type { CallContext } from './llm/types'

// Kept for the single grading.ts caller that uses it as a marker for "request
// reasoner mode". The new ChatOptions.reasoner flag is the preferred signal —
// REASONER_MODEL is no longer interpreted by the call path, but exporting the
// constant prevents a flood of import-site changes during the Phase 4 rollout.
// Callers should migrate to `opts.reasoner = true` over time.
export const REASONER_MODEL = 'deepseek-reasoner'
