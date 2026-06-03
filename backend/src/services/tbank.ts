import crypto from 'crypto'
import axios from 'axios'
import { logger } from '../lib/logger'
import { AppError } from '../errors/AppError'

// T-Bank (Tinkoff) Internet Acquiring — one-stage payment flow.
// Docs: https://developer.tbank.ru/eacq/scenarios/payments/
//
// All API calls live here. No other file talks to T-Bank directly.

const BASE_URL = process.env.TBANK_API_URL ?? 'https://securepay.tinkoff.ru/v2'

function credentials(): { terminalKey: string; password: string } {
  const terminalKey = process.env.TBANK_TERMINAL_KEY
  const password    = process.env.TBANK_TERMINAL_PASSWORD
  if (!terminalKey || !password) {
    throw new AppError('Платежи временно недоступны', 503, 'PAYMENTS_NOT_CONFIGURED')
  }
  return { terminalKey, password }
}

export function paymentsConfigured(): boolean {
  return Boolean(process.env.TBANK_TERMINAL_KEY && process.env.TBANK_TERMINAL_PASSWORD)
}

// ─── Token signature ──────────────────────────────────────────────────────────
// Algorithm (T-Bank): take all ROOT key/value pairs (exclude nested objects/arrays
// and the Token itself), add the terminal Password, sort by key alphabetically,
// concatenate the values in that order, then SHA-256 (hex, lowercase).

export function computeToken(
  params: Record<string, unknown>,
  password: string
): string {
  const flat: Record<string, string> = { Password: password }

  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token') continue
    if (value === undefined || value === null) continue
    // Skip nested objects/arrays (Receipt, DATA) — they are not part of the token
    if (typeof value === 'object') continue
    flat[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  }

  const concatenated = Object.keys(flat)
    .sort()
    .map((k) => flat[k])
    .join('')

  return crypto.createHash('sha256').update(concatenated, 'utf8').digest('hex')
}

/** Verify a webhook notification's Token against our terminal password. */
export function verifyNotificationToken(body: Record<string, unknown>): boolean {
  if (!paymentsConfigured()) return false
  const { password } = credentials()
  const received = String(body.Token ?? '')
  const expected = computeToken(body, password)
  // constant-time compare
  return received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// ─── Init — create a payment, returns a URL to redirect the customer to ───────

// ─── Receipt (54-ФЗ fiscalization) ────────────────────────────────────────────
// Required when the terminal has fiscalization enabled. Excluded from the Token
// (computeToken skips nested objects).

export interface ReceiptItem {
  Name:          string
  Price:         number   // kopecks, per unit
  Quantity:      number
  Amount:        number   // kopecks, Price * Quantity
  Tax:           'none' | 'vat0' | 'vat10' | 'vat20' | 'vat110' | 'vat120'
  PaymentMethod: 'full_payment' | 'full_prepayment'
  PaymentObject: 'service' | 'commodity'
}

export interface Receipt {
  Email:    string
  Taxation: 'osn' | 'usn_income' | 'usn_income_outcome' | 'envd' | 'esn' | 'patent'
  Items:    ReceiptItem[]
}

/** Build a single-line receipt for a subscription purchase (УСН доходы-расходы, без НДС). */
export function buildSubscriptionReceipt(
  email: string,
  itemName: string,
  amountKopecks: number
): Receipt {
  return {
    Email:    email,
    Taxation: 'usn_income_outcome',
    Items: [{
      Name:          itemName.slice(0, 128),     // T-Bank caps name length
      Price:         amountKopecks,
      Quantity:      1,
      Amount:        amountKopecks,
      Tax:           'none',                       // УСН — без НДС
      PaymentMethod: 'full_payment',
      PaymentObject: 'service',
    }],
  }
}

export interface InitParams {
  orderId:        string
  amountKopecks:  number
  description:    string
  notificationURL: string
  successURL:     string
  failURL:        string
  customerKey?:   string   // enables saving the card for future recurring charges
  receipt?:       Receipt  // 54-ФЗ fiscal receipt
  recurrent?:     boolean  // Recurrent:"Y" — registers the card for off-session charges
}

export interface InitResult {
  paymentId:  string
  paymentURL: string
  status:     string
}

export async function initPayment(p: InitParams): Promise<InitResult> {
  const { terminalKey, password } = credentials()

  const request: Record<string, unknown> = {
    TerminalKey:     terminalKey,
    Amount:          p.amountKopecks,
    OrderId:         p.orderId,
    Description:     p.description,
    NotificationURL: p.notificationURL,
    SuccessURL:      p.successURL,
    FailURL:         p.failURL,
    ...(p.customerKey ? { CustomerKey: p.customerKey } : {}),
    ...(p.recurrent ? { Recurrent: 'Y' } : {}),
  }
  // Token is computed BEFORE attaching nested objects (Receipt is excluded anyway)
  request.Token = computeToken(request, password)
  if (p.receipt) request.Receipt = p.receipt

  const { data } = await axios.post(`${BASE_URL}/Init`, request, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  })

  if (!data.Success) {
    logger.error({ message: 'T-Bank Init failed', errorCode: data.ErrorCode, details: data.Message, orderId: p.orderId })
    throw new AppError('Не удалось создать платёж. Попробуйте ещё раз.', 502, 'PAYMENT_INIT_FAILED')
  }

  return {
    paymentId:  String(data.PaymentId),
    paymentURL: String(data.PaymentURL),
    status:     String(data.Status),
  }
}

// ─── GetState — query a payment's current status ──────────────────────────────

// ─── Cancel — full refund of a CONFIRMED payment ──────────────────────────────

export async function refundPayment(paymentId: string): Promise<string> {
  const { terminalKey, password } = credentials()
  // No Amount → full refund of the original amount.
  const request: Record<string, unknown> = { TerminalKey: terminalKey, PaymentId: paymentId }
  request.Token = computeToken(request, password)

  const { data } = await axios.post(`${BASE_URL}/Cancel`, request, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  })
  if (!data.Success) {
    logger.error({ message: 'T-Bank Cancel failed', errorCode: data.ErrorCode, details: data.Message, paymentId })
    throw new AppError('Не удалось оформить возврат', 502, 'REFUND_FAILED')
  }
  return String(data.Status)   // REFUNDED | PARTIAL_REFUNDED | CANCELED
}

export async function getPaymentState(paymentId: string): Promise<string> {
  const { terminalKey, password } = credentials()
  const request: Record<string, unknown> = { TerminalKey: terminalKey, PaymentId: paymentId }
  request.Token = computeToken(request, password)

  const { data } = await axios.post(`${BASE_URL}/GetState`, request, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  })
  if (!data.Success) {
    throw new AppError('Не удалось получить статус платежа', 502, 'PAYMENT_STATE_FAILED')
  }
  return String(data.Status)
}

// ─── Recurring ─────────────────────────────────────────────────────────────────

/**
 * Fetch the RebillId for a customer's saved card (registered via a Recurrent
 * payment). Webhook-independent way to obtain the rebill token. Returns the
 * RebillId of the first active card, or null if none.
 */
export async function getRebillId(customerKey: string): Promise<string | null> {
  const { terminalKey, password } = credentials()
  const request: Record<string, unknown> = { TerminalKey: terminalKey, CustomerKey: customerKey }
  request.Token = computeToken(request, password)

  const { data } = await axios.post(`${BASE_URL}/GetCardList`, request, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20_000,
  })
  // GetCardList returns an array of cards (not the usual {Success} envelope)
  const cards: Array<{ Status?: string; RebillId?: string }> = Array.isArray(data) ? data : []
  const active = cards.find((c) => c.Status === 'A' && c.RebillId) ?? cards.find((c) => c.RebillId)
  return active?.RebillId ? String(active.RebillId) : null
}

/**
 * Charge a saved card off-session. Does Init (no Recurrent) → Charge(RebillId).
 * Returns the resulting status (CONFIRMED on success for one-stage terminals).
 */
export async function chargeRecurrent(params: {
  orderId:       string
  amountKopecks: number
  description:   string
  customerKey:   string
  rebillId:      string
  receipt?:      Receipt
}): Promise<{ status: string; success: boolean; paymentId: string }> {
  const { terminalKey, password } = credentials()

  // 1. Init a new payment (no Recurrent flag; reuse the saved customer + receipt)
  const initReq: Record<string, unknown> = {
    TerminalKey: terminalKey,
    Amount:      params.amountKopecks,
    OrderId:     params.orderId,
    Description: params.description,
    CustomerKey: params.customerKey,
  }
  initReq.Token = computeToken(initReq, password)
  if (params.receipt) initReq.Receipt = params.receipt

  const initRes = await axios.post(`${BASE_URL}/Init`, initReq, {
    headers: { 'Content-Type': 'application/json' }, timeout: 20_000,
  })
  if (!initRes.data.Success) {
    return { status: 'INIT_FAILED', success: false, paymentId: '' }
  }
  const paymentId = String(initRes.data.PaymentId)

  // 2. Charge the saved card off-session
  const chargeReq: Record<string, unknown> = { TerminalKey: terminalKey, PaymentId: paymentId, RebillId: params.rebillId }
  chargeReq.Token = computeToken(chargeReq, password)

  const chargeRes = await axios.post(`${BASE_URL}/Charge`, chargeReq, {
    headers: { 'Content-Type': 'application/json' }, timeout: 20_000,
  })

  const status = String(chargeRes.data.Status ?? (chargeRes.data.Success ? 'CONFIRMED' : 'REJECTED'))
  return { status, success: Boolean(chargeRes.data.Success) && (status === 'CONFIRMED' || status === 'AUTHORIZED'), paymentId }
}
