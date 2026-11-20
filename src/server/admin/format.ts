// Pure display helpers shared by server modules and admin components (no server-only imports).
const IST = 'Asia/Kolkata'

/** Accession-style short id, same scheme as the patient workspace header: OS·ABC123 (last 6 hex of the uuid). */
export const accession = (id: string) => `OS·${id.replace(/-/g, '').slice(-6).toUpperCase()}`

/** 8-hex short id for rows that are not patients (staff, devices, requests). The LAST 8: ids are time-ordered, so the first 8 are the same for most rows. */
export const shortId = (id: string | null | undefined) => (id ? id.replace(/-/g, '').slice(-8) : '—')

export const istDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export const istDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** Ratio → "62.5%"; null (no denominator) → "—". Never invents a number. */
export const pctText = (r: { num: number; den: number }, digits = 1) =>
  r.den > 0 ? `${((r.num / r.den) * 100).toFixed(digits).replace(/\.0+$/, '')}%` : '—'

export const daysText = (d: number | null) => (d == null ? '—' : `${d.toFixed(1).replace(/\.0$/, '')} d`)
export const minutesText = (m: number | null) => (m == null ? '—' : `${m.toFixed(1).replace(/\.0$/, '')} min`)

/** "1 entry", "2 entries": the singular for one, the given plural (or the word plus s) otherwise. */
export const plural = (n: number, word: string, many = `${word}s`) => (n === 1 ? word : many)
