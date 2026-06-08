import client from './client'

// Fetch a CSV endpoint with the JWT attached, then trigger a browser download.
// (A plain <a href> can't send the Authorization header, so we go via axios.)
export async function downloadCsv(url: string, params?: Record<string, unknown>): Promise<void> {
  const res = await client.get(url, { params, responseType: 'blob' })
  const cd = (res.headers['content-disposition'] as string) || ''
  const match = /filename="?([^"]+)"?/.exec(cd)
  const filename = match?.[1] ?? 'export.csv'

  const blobUrl = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}
