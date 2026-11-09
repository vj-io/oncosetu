import { describe, expect, it } from 'vitest'
import { labPanels, PREAUTH_LINES, PREAUTH_REQUIREMENTS, preauthFile, preauthSummary, type FileDoc } from './preauth'

const doc = (id: string, docType: FileDoc['docType'], documentDate: string | null = null): FileDoc => ({ id, docType, documentDate, institution: null, title: id })

describe('PM-JAY oncology pre-authorisation file check', () => {
  it('marks each asked-for document in the file or not, newest matching document first', () => {
    const f = preauthFile('chemotherapy', [doc('old-hpe', 'pathology_report', '2026-01-02'), doc('new-hpe', 'pathology_report', '2026-03-04'), doc('Complete Blood Count', 'lab_report')])
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
  it('the blood-test row is complete only when CBC, LFT and RFT are each named on a lab report', () => {
    const cbc = doc('CBC report', 'lab_report', '2026-03-01')
    const chem = { ...doc('Biochemistry', 'lab_report', '2026-03-01'), labNames: ['S. Bilirubin (Total)', 'SGPT (ALT)', 'SGOT (AST)'] }
    const row = (docs: FileDoc[]) => preauthFile('chemotherapy', docs).rows.find((r) => r.panels)!
    expect(row([cbc])).toMatchObject({ status: 'partial', missingPanels: ['LFT', 'RFT'] })
    expect(row([cbc, chem])).toMatchObject({ status: 'partial', missingPanels: ['RFT'] })
    const rft = { ...doc('Kidney Function Test', 'lab_report', '2026-03-02') }
    expect(row([cbc, chem, rft])).toMatchObject({ status: 'in_file', missingPanels: [] })
    // a partial row is not counted as in the file
    expect(preauthFile('chemotherapy', [cbc, chem, rft]).inFile - preauthFile('chemotherapy', [cbc, chem]).inFile).toBe(1)
  })
  it('names panels from titles or from two of their tests, never from one stray word', () => {
    expect(labPanels(['संपूर्ण रक्त गणना (CBC) रिपोर्ट'])).toEqual(['CBC'])
    expect(labPanels(['Haemogram'])).toEqual(['CBC'])
    expect(labPanels(['Haemoglobin', 'Platelet count'])).toEqual(['CBC'])
    expect(labPanels(['Serum creatinine', 'Blood urea'])).toEqual(['RFT'])
    expect(labPanels(['Serum creatinine'])).toEqual([])
    expect(labPanels(['Thyroid profile'])).toEqual([])
  })
  it('worklist summary counts only the papers asked for before pre-authorisation', () => {
    const s = preauthSummary('surgery', [doc('Consultation', 'consult_note', '2026-03-01'), doc('Biopsy', 'pathology_report', '2026-03-02')])
    expect(s).toEqual({ line: 'surgery', inFile: 2, checkable: 3, missing: ['Imaging named for the package (mammography in the breast example; CT or MRI optional)'] })
  })
})
