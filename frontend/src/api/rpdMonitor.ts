import client from './client'
import type { RpdParseFlag, RpdOverview } from '../../../shared/types'
export type { RpdGroupOverview, RpdLeaderDept, RpdRegressedDept, RpdAllDept, RpdOverview } from '../../../shared/types'

export interface RpdSnapshot {
  id:               string
  institution_id:   string
  uploaded_by:      string | null
  captured_at:      string
  period_label:     string | null
  source_filename:  string | null
  created_at:       string
  row_count?:       number
}

export interface RpdDeptGroup {
  id:             string
  institution_id: string
  name:           string
  sort_order:     number
  dept_codes:     string[]
}

export async function getRpdMapping(): Promise<RpdDeptGroup[]> {
  return (await client.get<RpdDeptGroup[]>('/api/institution/rpd/mapping')).data
}

export interface RpdUploadResult {
  snapshot: RpdSnapshot
  flags:    RpdParseFlag[]
  overview: RpdOverview
}

export async function uploadRpdExport(file: File): Promise<RpdUploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post<RpdUploadResult>('/api/institution/rpd/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function listRpdSnapshots(): Promise<RpdSnapshot[]> {
  return (await client.get<RpdSnapshot[]>('/api/institution/rpd/snapshots')).data
}

export async function updateRpdSnapshotDate(id: string, capturedAt: string): Promise<RpdSnapshot> {
  return (await client.patch<RpdSnapshot>(`/api/institution/rpd/snapshots/${id}`, { capturedAt })).data
}

export async function deleteRpdSnapshot(id: string): Promise<void> {
  await client.delete(`/api/institution/rpd/snapshots/${id}`)
}

export async function getRpdOverview(snapshotId?: string): Promise<RpdOverview | null> {
  const res = await client.get<RpdOverview | null>('/api/institution/rpd/overview', {
    params: snapshotId ? { snapshotId } : undefined,
  })
  return res.data
}

export async function createRpdGroup(name: string): Promise<RpdDeptGroup> {
  return (await client.post<RpdDeptGroup>('/api/institution/rpd/mapping/groups', { name })).data
}

export async function assignRpdDepts(groupId: string, deptCodes: string[]): Promise<void> {
  await client.post('/api/institution/rpd/mapping/assign', { groupId, deptCodes })
}

export async function learnRpdMapping(file: File): Promise<string[]> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post<{ deptCodes: string[] }>('/api/institution/rpd/mapping/learn', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.deptCodes
}

async function downloadBlob(url: string, params: Record<string, unknown> | undefined, fallbackName: string): Promise<void> {
  const res = await client.get(url, { params, responseType: 'blob' })
  const cd = (res.headers['content-disposition'] as string) || ''
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/.exec(cd)
  const filename = match ? decodeURIComponent(match[1]) : fallbackName

  const blobUrl = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

export async function downloadRpdMaster(snapshotId?: string): Promise<void> {
  await downloadBlob('/api/institution/rpd/export/master', snapshotId ? { snapshotId } : undefined, 'РПД_сводка.xlsx')
}

export async function downloadRpdGroup(groupId: string, snapshotId?: string): Promise<void> {
  await downloadBlob(`/api/institution/rpd/export/group/${groupId}`, snapshotId ? { snapshotId } : undefined, 'РПД_институт.xlsx')
}

export async function downloadRpdReminder(groupId: string, snapshotId?: string): Promise<void> {
  await downloadBlob(`/api/institution/rpd/reminders/${groupId}`, snapshotId ? { snapshotId } : undefined, 'Напоминание.docx')
}

export interface RpdReminderRow {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  planCount: number
  rpdDone:   number
  rpdDebt:   number
  rpdPct:    number
}

export interface RpdReminderPreview {
  groupName: string
  dateStr:   string
  narrative: string
  rows:      RpdReminderRow[]
  text:      string
}

export async function getRpdReminderText(groupId: string, snapshotId?: string): Promise<RpdReminderPreview> {
  const res = await client.get<RpdReminderPreview>(`/api/institution/rpd/reminders/${groupId}`, {
    params: { format: 'text', ...(snapshotId ? { snapshotId } : {}) },
  })
  return res.data
}
