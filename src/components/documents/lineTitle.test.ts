import { describe, expect, it } from 'vitest'
import { lineTitle } from './SourceViewer'

const ev = (eventType: string, fields: Record<string, unknown>, quote: string) =>
  ({ id: 'e', eventType, fields, eventDate: null, evidence: [{ pageNo: 1, charStart: 0, charEnd: 5, quote, bbox: null }] }) as unknown as Parameters<typeof lineTitle>[0]

describe('fact line titles (DOC-08)', () => {
  it('shows the first words of the quote when the fields give only the label', () => {
    const t = lineTitle(ev('margins_documented', {}, 'Both resection margins and the radial margin are free of tumour, with a clearance of 3 mm.'))
    expect(t.startsWith('Both resection margins')).toBe(true)
    expect(t.endsWith('…')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(61)
  })
  it('keeps a real value as the title', () => {
    expect(lineTitle(ev('diagnosis_documented', { section_text: 'Adenocarcinoma, moderately differentiated' }, 'ADENOCARCINOMA'))).toBe('Adenocarcinoma, moderately differentiated')
  })
})
