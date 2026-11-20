import { describe, expect, it } from 'vitest'
import { redact } from './log'

describe('log redaction (PRD §10.2)', () => {
  it('keeps the database\'s own reason from a failed query (its cause), scrubbed like the rest', () => {
    const pg = Object.assign(new Error('value too long for sunita@example.com'), { code: '54000' })
    const out = JSON.stringify(redact(new Error('Failed query: insert ... params: ...', { cause: pg })))
    expect(out).toContain('54000')
    expect(out).toContain('value too long')
    expect(out).not.toContain('example.com')
  })

  it('keeps only the start of an error message (a failed file write once logged the whole file)', () => {
    const out = redact(new Error('Failed query: insert ... params: ' + 'ab'.repeat(5_000_000))) as { message: string }
    expect(out.message.length).toBeLessThanOrEqual(2000)
    expect(out.message.startsWith('Failed query: insert')).toBe(true)
  })

  it('drops sensitive keys and scrubs phones/emails anywhere', () => {
    const out = JSON.stringify(redact({
      patientName: 'Sunita Devi', phone: '+91 98765 43210', quote: 'wide local excision', body: 'Your code is 123456',
      note: 'call 9876543210 or mail sunita@example.com', nested: { dob: '1975-03-12', staffName: 'Asha' }, code: '123456',
      documentId: '0193a000-0000-7000-8000-000000000001', status: 'done',
    }))
    for (const s of ['Sunita', '98765', 'excision', '123456', 'example.com', '1975', 'Asha']) expect(out).not.toContain(s)
    expect(out).toContain('0193a000-0000-7000-8000-000000000001')
    expect(out).toContain('done')
  })
})
