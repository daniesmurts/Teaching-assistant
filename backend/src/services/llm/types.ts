// Provider-agnostic LLM abstraction.
//
// Phase 4 of the loop work. Today everything calls into `services/deepseek.ts`;
// this file is the contract every provider implementation honours so we can
// route per-institution to DeepSeek (default, possibly self-hosted on RU
// infra), Yandex GPT (RU-resident), or future providers without callers
// having to know which one is in use.
//
// Embedding calls always go through the Yandex provider regardless of the
// caller's institutional preference — that's a hard technical constraint
// (vector-space compatibility), not a configuration. The registry enforces it.

export type ProviderName = 'deepseek' | 'yandex' | 'gigachat' | 'qwen'

export interface ChatMessage {
  role:    'system' | 'user' | 'assistant'
  content: string
}

export type Feature = 'grading' | 'presentation' | 'feedback_email' | 'embedding' | 'criteria_assist'

export interface CallContext {
  teacherId:      string
  institutionId?: string
  feature:        Feature
}

export interface ChatOptions {
  jsonMode?:    boolean       // request strict JSON output where provider supports it
  context?:     CallContext
  temperature?: number
  maxTokens?:   number
  reasoner?:    boolean        // request step-by-step reasoning (provider may interpret differently)
  // Force routing to a specific provider, bypassing institution preference.
  // Used by the eval harness when comparing providers on the same corpus,
  // and internally by the calc-grading carve-out (DeepSeek-only reasoner).
  providerOverride?: ProviderName
}

export interface ProviderCapabilities {
  // Strict JSON response_format with guaranteed valid JSON. Providers without
  // this fall back to an instruction-level "respond only with JSON" with a
  // parse-and-retry loop in chatJSON.
  strictJsonMode:  boolean
  // True iff the provider has a dedicated chain-of-thought / reasoning model
  // (DeepSeek's reasoner). Calc grading mode uses this.
  reasonerMode:    boolean
  // Upper bound on generated tokens we ask for in any single call.
  maxOutputTokens: number
}

export interface LLMProvider {
  name:        ProviderName
  capabilities: ProviderCapabilities

  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>

  chatJSON<T>(
    messages:   ChatMessage[],
    retryLabel?: string,
    opts?:      ChatOptions,
  ): Promise<T>

  embed(text: string, ctx?: CallContext): Promise<number[]>
}
