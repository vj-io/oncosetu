import { describe, expect, it } from 'vitest'
import type { Candidate } from '@/core/gate'
import { gateAndDate, type GatedPages } from './core'

// Dates on facts: an LLM-extracted fact keeps the date that is in its quote, and a document's own day-first dates settle
// the ambiguity flag. Only the usable pages are given, as when a person keys one fact (actions.ts): no class, no page classes.
const page = (text: string) => ({ pageNo: 1, text, source: 'text_layer', lowConfidence: false }) as never
const classified = (text: string): GatedPages => ({ usable: [page(text)] })
const DOC = { documentDate: { iso: '2026-05-12', precision: 'day' as const, flags: [], raw: '12/05/2026' } }
const NO_DOC = { documentDate: null }
const RECEIVED = new Date('2026-11-07T06:00:00Z')

const RX = 'DR. A SAXENA\nPatient: A B  Date: 12/05/2026\nNext visit: 02/06/2026 with CBC and LFT done one day before.\n'
const proc = (raw: string, quote: string): Candidate => ({ event_type: 'procedure_documented', fields: { procedure_text: 'hemicolectomy', event_date_text: raw }, quote, page_no: 1, origin: 'rules' })

describe('LLM facts keep the date written in their quote', () => {
  const cand: Candidate = {
    event_type: 'follow_up_documented', fields: { appointment_text: 'Next visit' },
    quote: 'Next visit: 02/06/2026 with CBC and LFT done one day before.', page_no: 1, origin: 'llm',
  }
  it('uses the one date in the quote when the model left the date field empty', () => {
    const { drafts } = gateAndDate([cand], classified(RX), DOC, RECEIVED, 'llm')
    expect(drafts[0].eventDate).toBe('2026-06-02')
    expect(drafts[0].dateFlags).not.toContain('date_unknown')
    expect(drafts[0].flags.date_from_document).toBeUndefined()
  })
  it('leaves a quote with several dates undecided', () => {
    const text = 'Cycle 2 on 03/03/2026 and Cycle 3 on 24/03/2026 are planned.\n'
    const c: Candidate = { event_type: 'follow_up_documented', fields: { appointment_text: 'Cycle 2' }, quote: text.trim(), page_no: 1, origin: 'llm' }
    const { drafts } = gateAndDate([c], classified(text), DOC, RECEIVED, 'llm')
    expect(drafts[0].eventDate).toBeNull()
  })
})

describe('date_ambiguous only when the date really is ambiguous', () => {
  it('flags a numeric date with nothing to settle it', () => {
    const t = 'Right hemicolectomy done on 03/04/2026.\n'
    const { drafts } = gateAndDate([proc('03/04/2026', t.trim())], classified(t), NO_DOC, new Date('2026-06-01T00:00:00Z'), 'rules')
    expect(drafts[0].eventDate).toBe('2026-04-03')
    expect(drafts[0].dateFlags).toContain('date_ambiguous')
  })
  it('does not flag it when the same document has a date that can only be day first', () => {
    const t = 'Admitted 22/03/2026.\nRight hemicolectomy done on 03/04/2026.\n'
    const { drafts } = gateAndDate([proc('03/04/2026', 'Right hemicolectomy done on 03/04/2026.')], classified(t), NO_DOC, new Date('2026-06-01T00:00:00Z'), 'rules')
    expect(drafts[0].dateFlags).not.toContain('date_ambiguous')
  })
  it('does not flag it when the month-first reading would lie after the day the document arrived', () => {
    const t = 'Right hemicolectomy done on 12/05/2026.\n'
    const { drafts } = gateAndDate([proc('12/05/2026', t.trim())], classified(t), NO_DOC, new Date('2026-11-07T00:00:00Z'), 'rules')
    expect(drafts[0].eventDate).toBe('2026-05-12')
    expect(drafts[0].dateFlags).not.toContain('date_ambiguous')
  })
  it('still flags it when both readings are in the past', () => {
    const t = 'Right hemicolectomy done on 03/04/2026.\n'
    const { drafts } = gateAndDate([proc('03/04/2026', t.trim())], classified(t), NO_DOC, new Date('2026-11-07T00:00:00Z'), 'rules')
    expect(drafts[0].dateFlags).toContain('date_ambiguous')
  })
})
