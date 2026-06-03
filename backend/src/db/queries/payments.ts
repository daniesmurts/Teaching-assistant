import { pool } from '../connection'

export interface PaymentRow {
  id:             string
  order_id:       string
  teacher_id:     string
  plan:           string
  amount_kopecks: number
  status:         string
  payment_id:     string | null
  rebill_id:      string | null
  created_at:     Date
  confirmed_at:   Date | null
}

export async function createPayment(data: {
  orderId:       string
  teacherId:     string
  plan:          string
  amountKopecks: number
}): Promise<PaymentRow> {
  const { rows } = await pool.query<PaymentRow>(
    `INSERT INTO payments (order_id, teacher_id, plan, amount_kopecks, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [data.orderId, data.teacherId, data.plan, data.amountKopecks]
  )
  return rows[0]
}

export async function setPaymentId(orderId: string, paymentId: string): Promise<void> {
  await pool.query('UPDATE payments SET payment_id = $2 WHERE order_id = $1', [orderId, paymentId])
}

export async function findPaymentByOrderId(orderId: string): Promise<PaymentRow | null> {
  const { rows } = await pool.query<PaymentRow>(
    'SELECT * FROM payments WHERE order_id = $1 LIMIT 1',
    [orderId]
  )
  return rows[0] ?? null
}

/** Mark confirmed. Returns true only on the FIRST confirmation (idempotent guard). */
export async function confirmPayment(orderId: string, rebillId?: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE payments
     SET status = 'confirmed', confirmed_at = NOW(), rebill_id = COALESCE($2, rebill_id)
     WHERE order_id = $1 AND status <> 'confirmed'
     RETURNING id`,
    [orderId, rebillId ?? null]
  )
  return rows.length > 0
}

/**
 * Pending payments that have a T-Bank PaymentId, are old enough that the
 * redirect flow has had time to finish (>2 min), but recent enough to still
 * be worth checking (<3 h). Used by the reconciliation sweep to settle
 * "paid but tab closed" cases without relying on the webhook.
 */
export async function findStalePendingPayments(): Promise<PaymentRow[]> {
  const { rows } = await pool.query<PaymentRow>(
    `SELECT * FROM payments
     WHERE status = 'pending'
       AND payment_id IS NOT NULL
       AND created_at < NOW() - INTERVAL '2 minutes'
       AND created_at > NOW() - INTERVAL '3 hours'
     ORDER BY created_at ASC
     LIMIT 100`
  )
  return rows
}

export async function findPaymentsByTeacher(teacherId: string): Promise<PaymentRow[]> {
  const { rows } = await pool.query<PaymentRow>(
    `SELECT * FROM payments WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [teacherId]
  )
  return rows
}

export async function markPaymentRefunded(orderId: string): Promise<void> {
  await pool.query(`UPDATE payments SET status = 'refunded' WHERE order_id = $1`, [orderId])
}

export async function rejectPayment(orderId: string): Promise<void> {
  await pool.query(
    `UPDATE payments SET status = 'rejected' WHERE order_id = $1 AND status = 'pending'`,
    [orderId]
  )
}
