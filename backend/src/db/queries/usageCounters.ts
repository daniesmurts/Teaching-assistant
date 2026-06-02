import { pool } from '../connection'

export interface UsageCounter {
  teacher_id:               string
  grades_this_month:        number
  presentations_this_month: number
  month_year:               string
}

export async function getOrCreateCounter(teacherId: string): Promise<UsageCounter> {
  // Upsert an empty row for this teacher so we always have a record
  await pool.query(
    `INSERT INTO usage_counters (teacher_id, month_year)
     VALUES ($1, TO_CHAR(NOW(), 'YYYY-MM'))
     ON CONFLICT (teacher_id) DO NOTHING`,
    [teacherId]
  )
  const { rows } = await pool.query<UsageCounter>(
    'SELECT * FROM usage_counters WHERE teacher_id = $1',
    [teacherId]
  )
  return rows[0]
}

export async function incrementUsage(
  teacherId: string,
  feature: 'grade' | 'presentation'
): Promise<void> {
  await pool.query('SELECT increment_usage($1, $2)', [teacherId, feature])
}
