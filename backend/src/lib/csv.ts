// Minimal RFC-4180 CSV builder. Prepends a UTF-8 BOM so Excel opens Cyrillic correctly.

function cell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))]
  return '﻿' + lines.join('\r\n')
}

export function csvFilename(base: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `${base}_${date}.csv`
}
