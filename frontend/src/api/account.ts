import client from './client'

export async function deleteAccount(password: string): Promise<void> {
  await client.delete('/api/account', { data: { password } })
}

/** Update the teacher's display name. Returns the new name on success. */
export async function updateProfileName(name: string): Promise<{ id: string; name: string }> {
  return (await client.patch<{ id: string; name: string }>('/api/account/profile', { name })).data
}

/**
 * Stream a JSON export of the teacher's account to disk. Submissions and
 * syllabuses default to OFF — the teacher opts in.
 */
export async function downloadAccountExport(opts: {
  include_submissions?: boolean
  include_syllabuses?:  boolean
} = {}): Promise<void> {
  const params = new URLSearchParams()
  if (opts.include_submissions) params.set('include_submissions', 'true')
  if (opts.include_syllabuses)  params.set('include_syllabuses',  'true')

  const res = await client.get<Blob>(
    `/api/account/export${params.toString() ? `?${params}` : ''}`,
    { responseType: 'blob' }
  )

  // Pull the filename out of Content-Disposition; fall back to a stamped name.
  const cd = (res.headers as Record<string, string>)['content-disposition'] ?? ''
  const match = /filename="?([^"]+)"?/.exec(cd)
  const filename = match?.[1] ?? `ispum-export-${new Date().toISOString().slice(0, 10)}.json`

  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
