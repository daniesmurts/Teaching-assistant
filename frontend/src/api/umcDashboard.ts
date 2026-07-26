import client from './client'
import { downloadCsv } from './download'
import type { UmcDashboardResult } from '../types'

export async function getUmcDashboard(): Promise<UmcDashboardResult> {
  const res = await client.get<UmcDashboardResult>('/api/institution/umc-dashboard')
  return res.data
}

export async function downloadUmcDashboardXlsx(): Promise<void> {
  await downloadCsv('/api/institution/umc-dashboard/export.xlsx')
}
