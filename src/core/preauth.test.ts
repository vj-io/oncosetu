import { describe, expect, it } from 'vitest'
import { PREAUTH_LINES, PREAUTH_REQUIREMENTS, preauthFile, type FileDoc } from './preauth'

const doc = (id: string, docType: FileDoc['docType'], documentDate: string | null = null): FileDoc => ({ id, docType, documentDate, institution: null, title: id })

describe('PM-JAY oncology pre-authorisation file check', () => {
  it('marks each asked-for document in the file or not, newest matching document first', () => {
    const f = preauthFile('chemotherapy', [doc('old-hpe', 'pathology_report', '2026-01-02'), doc('new-hpe', 'pathology_report', '2026-03-04'), doc('cbc', 'lab_report')])
    const biopsy = f.rows.find((r) => r.asked.startsWith('Biopsy'))!
    expect(biopsy.status).toBe('in_file')
    expect(biopsy.docs.map((d) => d.id)).toEqual(['new-hpe', 'old-hpe'])
    expect(f.rows.find((r) => r.asked.startsWith('Imaging'))!.status).toBe('not_in_file')
  })
  it('never reports a document OncoSetu does not hold (signed plan form, drug bar codes) as missing', () => {
    const f = preauthFile('chemotherapy', [])
    const held = f.rows.filter((r) => r.status === 'not_held').map((r) => r.asked)
    expect(held).toContain('Oncology Treatment Plan Approval form, filled and signed')
    expect(held).toContain('Bar codes of the drugs')
    expect(f.inFile).toBe(0)
    expect(f.checkable).toBe(f.rows.length - held.length)
  })
  it('counts only checkable rows; unclassified documents match nothing', () => {
    const f = preauthFile('radiotherapy', [doc('hpe', 'pathology_report'), doc('x', null), doc('rt', 'radiotherapy_summary')])
    expect(f).toMatchObject({ inFile: 2, checkable: 3 })
  })
  it('every treatment line asks for a pathology report before pre-authorisation and lists the signed plan form', () => {
    for (const { key } of PREAUTH_LINES) {
      const reqs = PREAUTH_REQUIREMENTS[key]
      expect(reqs.some((r) => r.stage === 'preauth' && r.accepts.includes('pathology_report')), key).toBe(true)
      expect(reqs.some((r) => r.asked.startsWith('Oncology Treatment Plan Approval form')), key).toBe(true)
    }
  })
})
