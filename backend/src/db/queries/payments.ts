import { pool } from '../connection'
import type { PaymentsSummary, MonthlyRevenue } from '../../../../shared/types'

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

// ─── Platform-admin business metrics ──────────────────────────────────────────
// Renewal charges are distinguishable by their order_id prefix: renewals.ts
// generates `rb_...` order ids; checkout payments use the payments route's
// format. That prefix is the only type marker — no schema change needed.

export interface AdminPaymentRow {
  id:             string
  order_id:       string
  teacher_id:     string
  teacher_email:  string
  teacher_name:   string | null
  plan:           string
  amount_kopecks: number
  status:         string
  is_renewal:     boolean
  created_at:     Date
  confirmed_at:   Date | null
}

export async function listAllPayments(opts: {
  status?: string
  limit:   number
  offset:  number
}): Promise<{ rows: AdminPaymentRow[]; total: number }> {
  const where = opts.status ? `WHERE p.status = $3` : ''
  const params: unknown[] = [opts.limit, opts.offset]
  if (opts.status) params.push(opts.status)

  const [list, count] = await Promise.all([
    pool.query<AdminPaymentRow>(
      `SELECT p.id, p.order_id, p.teacher_id, t.email AS teacher_email,
              t.name AS teacher_name, p.plan, p.amount_kopecks, p.status,
              (p.order_id LIKE 'rb\\_%') AS is_renewal,
              p.created_at, p.confirmed_at
         FROM payments p
         JOIN teachers t ON t.id = p.teacher_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2`,
      params
    ),
    pool.query<{ total: string }>(
      opts.status
        ? `SELECT COUNT(*) AS total FROM payments WHERE status = $1`
        : `SELECT COUNT(*) AS total FROM payments`,
      opts.status ? [opts.status] : []
    ),
  ])
  return { rows: list.rows, total: parseInt(count.rows[0].total, 10) }
}

export async function getPaymentsSummary(): Promise<PaymentsSummary> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(amount_kopecks) FROM payments
         WHERE status = 'confirmed'
           AND confirmed_at >= DATE_TRUNC('month', NOW())), 0)::int AS revenue_this_month_kopecks,
       COALESCE((SELECT SUM(amount_kopecks) FROM payments
         WHERE status = 'confirmed'
           AND confirmed_at >= NOW() - INTERVAL '30 days'), 0)::int AS revenue_30d_kopecks,
       (SELECT COUNT(*) FROM payments
         WHERE status = 'confirmed'
           AND confirmed_at >= NOW() - INTERVAL '30 days')::int     AS confirmed_30d,
       (SELECT COUNT(*) FROM payments
         WHERE status = 'rejected'
           AND created_at >= NOW() - INTERVAL '30 days')::int       AS rejected_30d,
       (SELECT COUNT(*) FROM teachers
         WHERE auto_renew AND rebill_id IS NOT NULL
           AND plan_expires_at > NOW())::int                        AS active_subscribers,
       (SELECT COUNT(*) FROM teachers
         WHERE renewal_failed_at IS NOT NULL)::int                  AS in_grace`
  )
  return rows[0]
}

export async function getRevenueByMonth(months: number): Promise<MonthlyRevenue[]> {
  const { rows } = await pool.query<MonthlyRevenue>(
    `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')          AS month,
            COALESCE(SUM(amount_kopecks) FILTER (WHERE status = 'confirmed'), 0)::int AS revenue_kopecks,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int            AS confirmed_count,
            COUNT(*) FILTER (WHERE status = 'rejected')::int             AS rejected_count
       FROM payments
      WHERE created_at >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) DESC`,
    [months]
  )
  return rows
}
