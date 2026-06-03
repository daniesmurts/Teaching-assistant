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
