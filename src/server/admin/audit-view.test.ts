import { describe, expect, it } from 'vitest'
import { AUDIT_CSV_HEADER, auditCsv } from './audit-view'

const row = (o: Partial<Parameters<typeof auditCsv>[0][number]> = {}) => ({
  seq: 7, at: new Date('2026-11-02T10:00:00Z'), actorId: '0193a000-0000-7000-8000-00000000a001', actorRole: 'records', action: 'document.attach',
  targetType: 'document', targetId: '0193a000-0000-7000-8000-00000000d001', requestId: 'req-1', details: { reason: 'match', count: 2 },
  prevHash: 'a'.repeat(64), hash: 'b'.repeat(64), ...o,
})

describe('audit CSV (ids only)', () => {
  it('has fixed id-only columns: no name, phone or free-text columns', () => {
    const [header, line] = auditCsv([row()]).split('\r\n')
    expect(header.split(',')).toEqual([...AUDIT_CSV_HEADER])
    expect(header).not.toMatch(/name|phone|dob|email|quote/i)
    expect(line.startsWith('7,2026-11-02T10:00:00.000Z,0193a000-0000-7000-8000-00000000a001,records,document.attach,')).toBe(true)
  })
  it('quotes JSON details and neutralises formula-looking cells', () => {
    const csv = auditCsv([row({ action: '=HYPERLINK("x")', details: { a: 'x,y' } })])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"{""a"":""x,y""}"')
  })
  it('exports nothing but the header when there are no rows', () => {
    expect(auditCsv([])).toBe(AUDIT_CSV_HEADER.join(',') + '\r\n')
  })
})
