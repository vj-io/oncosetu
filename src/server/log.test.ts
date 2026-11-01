import { describe, expect, it } from 'vitest'
import { redact } from './log'

describe('log redaction (PRD §10.2)', () => {
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
