import { pool } from '../connection'

export interface ConfidenceConfig {
  highStdMax: number
  lowStdMin:  number
  runId:      string | null
  nHigh:      number | null
  nLow:       number | null
  fittedAt:   string | null
}

/** Persisted calibrated thresholds, or null when never fitted (use defaults). */
export async function getConfidenceConfig(): Promise<ConfidenceConfig | null> {
  const { rows } = await pool.query<{
    high_std_max: string; low_std_min: string; run_id: string | null
    n_high: number | null; n_low: number | null; fitted_at: Date | null
  }>(`SELECT high_std_max, low_std_min, run_id, n_high, n_low, fitted_at
        FROM confidence_config WHERE id = TRUE`)
  if (!rows[0]) return null
  const r = rows[0]
  return {
    highStdMax: Number(r.high_std_max),
    lowStdMin:  Number(r.low_std_min),
    runId:      r.run_id,
    nHigh:      r.n_high,
    nLow:       r.n_low,
    fittedAt:   r.fitted_at?.toISOString() ?? null,
  }
}

export async function upsertConfidenceConfig(data: {
  highStdMax: number
  lowStdMin:  number
  runId?:     string | null
  nHigh?:     number | null
  nLow?:      number | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO confidence_config (id, high_std_max, low_std_min, run_id, n_high, n_low, fitted_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       high_std_max = EXCLUDED.high_std_max,
       low_std_min  = EXCLUDED.low_std_min,
       run_id       = EXCLUDED.run_id,
       n_high       = EXCLUDED.n_high,
       n_low        = EXCLUDED.n_low,
       fitted_at    = NOW()`,
    [data.highStdMax, data.lowStdMin, data.runId ?? null, data.nHigh ?? null, data.nLow ?? null]
  )
}
