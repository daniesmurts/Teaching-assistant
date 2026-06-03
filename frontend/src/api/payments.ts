import client from './client'

export type PurchasablePlan = 'pro_monthly' | 'pro_annual'

export interface CreatePaymentResponse {
  paymentUrl: string
  orderId:    string
}

export async function createPayment(plan: PurchasablePlan): Promise<CreatePaymentResponse> {
  const res = await client.post<CreatePaymentResponse>('/api/payments/create', { plan })
  return res.data
}

export interface PaymentStatus {
  status: 'pending' | 'confirmed' | 'rejected'
  plan:   string
}

export async function getPaymentStatus(orderId: string): Promise<PaymentStatus> {
  const res = await client.get<PaymentStatus>(`/api/payments/status/${orderId}`)
  return res.data
}

export interface PaymentHistoryItem {
  order_id:       string
  plan:           string
  amount_kopecks: number
  status:         'pending' | 'confirmed' | 'rejected'
  created_at:     string
  confirmed_at:   string | null
}

export async function getPaymentHistory(): Promise<PaymentHistoryItem[]> {
  const res = await client.get<PaymentHistoryItem[]>('/api/payments/history')
  return res.data
}

export async function setAutoRenew(enabled: boolean): Promise<void> {
  await client.post('/api/payments/auto-renew', { enabled })
}
