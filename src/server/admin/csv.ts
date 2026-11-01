// RFC 4180 CSV. Cells that a spreadsheet would run as a formula (= + - @ TAB CR) get a leading apostrophe.
export function csvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
