import { describe, expect, it } from 'vitest'
import { HEADLINE, NOT_CLAIMED, SECTIONS, tally } from './compliance'

const all = JSON.stringify({ HEADLINE, NOT_CLAIMED, SECTIONS })

describe('security and compliance content', () => {
  it('never claims to be HIPAA compliant or certified, and says so plainly', () => {
    expect(all).not.toMatch(/\bis HIPAA[- ]compliant|are HIPAA[- ]compliant|HIPAA[- ]certified|we are compliant|fully compliant/i)
    expect(HEADLINE).toMatch(/Built to HIPAA's safeguards/)
    expect(HEADLINE).toMatch(/roadmap/)
    expect(NOT_CLAIMED).toMatch(/not HIPAA compliant/)
  })
  it('covers HIPAA, DPDP and ABDM and every HIPAA safeguard the team asked for', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['hipaa', 'dpdp', 'abdm'])
    const hipaa = SECTIONS[0].rows.map((r) => r.area.toLowerCase()).join(' | ')
    for (const k of ['access control', 'unique user', 'audit controls', 'integrity', 'transmission', 'encryption at rest', 'automatic logoff', 'emergency access', 'minimum necessary', 'breach notification', 'business associate', 'risk assessment', 'workforce training']) expect(hipaa).toContain(k)
  })
  it('only the things that are really built are marked In place; BAAs, risk assessment and training are Planned', () => {
    const by = (a: string) => SECTIONS[0].rows.find((r) => r.area.toLowerCase().includes(a))!
    for (const a of ['business associate', 'risk assessment', 'workforce training']) expect(by(a).status).toBe('planned')
    for (const a of ['audit controls', 'emergency access', 'automatic logoff']) expect(by(a).status).toBe('in_place')
    expect(SECTIONS[1].rows.find((r) => r.area.includes('Data Protection Officer'))!.evidence).toContain('[ ]')
  })
  it('summary counts add up to every row', () => {
    const t = tally()
    expect(t.in_place + t.partly + t.planned).toBe(SECTIONS.reduce((n, s) => n + s.rows.length, 0))
    expect(t.in_place).toBeGreaterThan(0); expect(t.planned).toBeGreaterThan(0)
  })
})
