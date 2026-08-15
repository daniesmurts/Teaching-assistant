// The telemetry envelope shape — docs/on-prem-deployment.md §5.2.
//
// Every deployment sends this. Aggregates and identifiers ONLY — never
// submission text, never teacher names or emails. That rule is what makes
// this sellable to a customer's ИБ (§5.2), so it's enforced by the SHAPE of
// this type, not by convention: there is nowhere in here a raw string of
// user content could be placed without changing the type.

export interface ModelInfo {
  provider:      string
  modelId:       string
  endpointHost?: string   // absent for hosted APIs (DeepSeek/Yandex cloud) — only meaningful for self-hosted vLLM
  quantization?: string   // on-prem only
  tokensPerSec?: number   // on-prem only — throughput signal, not measurable against a hosted API
  calls24h:      number
  errorRate:     number   // 0..1
}

export interface UsageRow {
  month:                 string
  institutionId:         string
  activeSeats:           number
  seatsPurchased:        number | null
  overheadCallCount:     number
  overheadTokens:        number
  overheadCostUsd:       number
  amortizedRevenueRub:   number | null
  amortizedRevenueUsd:   number | null
}

export interface IncidentCount {
  code:        string
  count:       number
  windowStart: string   // ISO
  windowEnd:   string   // ISO
}

export interface TelemetryEnvelope {
  platform: {
    appVersion:    string
    schemaVersion: string   // most recently applied migration filename
    uptimeSeconds: number
  }
  health: {
    dbOk:       boolean
    queueDepth: number   // pending (not-yet-active) jobs, summed across all pg-boss queues — see agent.ts
    // failedJobs24h deliberately NOT included: pg-boss's public API
    // (getQueueSize) can't isolate "failed" cleanly — its `before` option
    // compares job-state ordering (state < X), which excludes failed jobs
    // rather than isolating them, and there's no time-windowed variant.
    // Getting it would mean querying pg-boss's own internal `pgboss.job`
    // table directly — a real fragility risk given this pg-boss version is
    // ALREADY deliberately pinned to v10.x because v12 changed too much
    // (jobQueue.ts). Revisit if this metric turns out to matter in practice.
  }
  models:    ModelInfo[]
  usage:     UsageRow[]
  seats: {
    active:   number
    licensed: number | null   // null until Track 2.7's licence file exists
  }
  incidents: IncidentCount[]
}
