import { describe, expect, it } from 'vitest'
import { erasureEligibleAfter } from './eligible'

const d = (s: string) => new Date(s)

describe('erasureEligibleAfter', () => {
  it('is the request date plus the org retention days when there is no encounter', () => {
    expect(erasureEligibleAfter({ requestedAt: d('2026-11-02T00:00:00Z'), retentionDays: 1095, lastEncounterAt: null }).toISOString()).toBe('2029-11-01T00:00:00.000Z')
  })
  it('uses the longer of retention and 3 years from the last encounter', () => {
    // retention (1095 days from the request) already runs past 3 years from an older encounter
    expect(erasureEligibleAfter({ requestedAt: d('2026-11-02T00:00:00Z'), retentionDays: 1095, lastEncounterAt: d('2026-01-10T00:00:00Z') }).toISOString()).toBe('2029-11-01T00:00:00.000Z')
    // a short retention setting cannot undercut the 3-year floor from the last encounter
    expect(erasureEligibleAfter({ requestedAt: d('2026-11-02T00:00:00Z'), retentionDays: 30, lastEncounterAt: d('2026-10-01T00:00:00Z') }).toISOString()).toBe('2029-10-01T00:00:00.000Z')
  })
  it('keeps a long retention setting over the floor', () => {
    expect(erasureEligibleAfter({ requestedAt: d('2026-11-02T00:00:00Z'), retentionDays: 3650, lastEncounterAt: d('2026-10-01T00:00:00Z') }).getUTCFullYear()).toBe(2036)
  })
})
