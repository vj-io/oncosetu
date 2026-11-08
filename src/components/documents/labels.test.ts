import { describe, expect, it } from 'vitest'
import { fmtDate, fmtDateTime } from './labels'

// The hand-written formatters must print exactly what Node's en-IN Intl printed before (server-rendered text unchanged).
describe('document board date formatting', () => {
  const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const DATETIME = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  it('matches Node Intl for every hour and month boundary', () => {
    for (let t = Date.UTC(2025, 11, 30, 18, 0); t < Date.UTC(2027, 0, 2); t += 37 * 60_000 + 13_000) {
      const iso = new Date(t).toISOString()
      expect(fmtDateTime(iso)).toBe(DATETIME.format(new Date(iso)))
      expect(fmtDate(iso.slice(0, 10))).toBe(DATE.format(new Date(iso.slice(0, 10) + 'T00:00:00Z')))
    }
    expect(fmtDate(null)).toBe('date not stated')
  })
})
