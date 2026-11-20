import { describe, expect, it } from 'vitest'
import { runGate } from '../gate'
import type { DocType } from '../types'
import { extractFallback } from '.'

// Real radiology and oncology reports read weakly in a private test (20 Nov 2026). These are NEW synthetic documents in the same
// structures (invented names, centres and dates): clinical-history sections, medicines named in a history, lesion sizes beside
// the word "margins", long impressions, signature blocks and footers, and earlier studies named as comparisons.

const run = (type: DocType, text: string) => {
  const pages = [{ pageNo: 1, text }]
  return runGate(extractFallback(pages, type).items, pages)
}
const of = (g: ReturnType<typeof run>, type: string) => g.accepted.filter((a) => a.candidate.event_type === type)
const quotes = (g: ReturnType<typeof run>, type: string) => of(g, type).map((a) => a.evidence.quote.replace(/\s+/g, ' '))

const MR = `LAKESHORE IMAGING CENTRE
MRI BRAIN WITH CONTRAST
Patient Name: Ms. Test Person     Age/Sex: 52 Y / F
Date of study: 14/08/2026
CLINICAL HISTORY/INDICATION:
Known case of carcinoma left breast, status post wide local excision and adjuvant
radiotherapy in 2024. Currently on olaparib. Evaluate for brain metastases.
TECHNIQUE
Axial T1, T2, FLAIR and post-contrast sequences.
FINDINGS
A 1.2 cm lesion with irregular margins is seen in the right frontal lobe.
Compared with prior MRI dated 12 Feb 2025, the lesion is new.
IMPRESSION:
1. Solitary enhancing right frontal lesion, new since the prior study, as described above in
detail with the surrounding oedema and mild mass effect on the adjacent sulci and frontal horn.

2. No other focal lesion. Dural enhancement is not seen. The ventricles are normal in size
and position and the basal cisterns are patent. Correlation with clinical findings is advised.
Dr. Test Reader MD
Consultant Radiologist
Electronically signed by Dr. Test Reader
Report status: Final`

describe('clinical history / indication section', () => {
  it('is kept as the diagnosis as written, word for word, up to the next heading', () => {
    const g = run('imaging_report', MR)
    const dx = of(g, 'diagnosis_documented')
    expect(dx).toHaveLength(1)
    expect(dx[0].evidence.quote.replace(/\s+/g, ' ')).toBe(
      'CLINICAL HISTORY/INDICATION: Known case of carcinoma left breast, status post wide local excision and adjuvant radiotherapy in 2024. Currently on olaparib. Evaluate for brain metastases.',
    )
    expect(dx[0].candidate.fields.section_text).toBe('Known case of carcinoma left breast, status post wide local excision and adjuvant radiotherapy in 2024. Currently on olaparib. Evaluate for brain metastases.')
  })
  it('reads an inline "Indication:" line and a heading-only layout', () => {
    expect(quotes(run('imaging_report', 'CITY SCAN CENTRE\nCT CHEST\nDate of study: 02/09/2026\nIndication: Carcinoma breast on letrozole, follow-up.\nFINDINGS\nNo nodule.'), 'diagnosis_documented')).toEqual(['Indication: Carcinoma breast on letrozole, follow-up.'])
    expect(quotes(run('imaging_report', 'CITY SCAN CENTRE\nCT CHEST\nDate of study: 02/09/2026\nClinical history\nCarcinoma ovary, post surgery.\n\nFindings\nNo nodule.'), 'diagnosis_documented')).toEqual(['Clinical history Carcinoma ovary, post surgery.'])
  })
  it('reads no history section from a lab report', () => {
    expect(of(run('lab_report', 'LAB\nCBC\nDate: 02/09/2026\nClinical history: carcinoma breast.\nHaemoglobin 11.8 g/dL'), 'diagnosis_documented')).toEqual([])
  })
})

describe('medicines named in a history', () => {
  it('keeps "on olaparib" and "on PARP inhibitor" as history lines, word for word', () => {
    const g = run('consult_note', 'CLINIC\nCONSULTATION NOTE\nDate of visit: 14-04-2026\nPatient is on olaparib since March 2026.\nShe continues on PARP inhibitor and tolerating well.\nAdvised to start letrozole next month.')
    expect(quotes(g, 'history_documented')).toEqual(['Patient is on olaparib since March 2026.', 'She continues on PARP inhibitor and tolerating well.'])
  })
  it('reads the lexicon across classes, and ignores a plan or a prescription line', () => {
    for (const d of ['palbociclib', 'ribociclib', 'abemaciclib', 'anastrozole', 'exemestane', 'tamoxifen', 'trastuzumab', 'paclitaxel', 'docetaxel', 'doxorubicin', 'epirubicin', 'capecitabine', 'pembrolizumab', 'nivolumab', 'niraparib', 'enzalutamide', 'osimertinib']) {
      expect(quotes(run('consult_note', `CLINIC\nCONSULTATION NOTE\nDate of visit: 14-04-2026\nShe is currently on ${d} for the past year.`), 'history_documented')).toEqual([`She is currently on ${d} for the past year.`])
    }
    expect(of(run('consult_note', 'CLINIC\nCONSULTATION NOTE\nDate of visit: 14-04-2026\nPlan: consider tamoxifen after review.'), 'history_documented')).toEqual([])
    expect(of(run('prescription_printed', 'CLINIC\nPRESCRIPTION\nDate: 14-04-2026\n1. Tab. Olaparib 150 mg BD'), 'history_documented')).toEqual([])
  })
})

describe('lesion size and radiotherapy history are not margins or radiotherapy', () => {
  it('files nothing under margins for a lesion size or a lesion border', () => {
    expect(of(run('imaging_report', MR), 'margins_documented')).toEqual([])
    expect(of(run('imaging_report', 'CENTRE\nMRI BREAST\nDate of study: 02/09/2026\nFindings\nA 2.1 x 1.8 cm mass with spiculated margins in the upper outer quadrant.'), 'margins_documented')).toEqual([])
    expect(of(run('pathology_report', 'LAB\nHISTOPATHOLOGY REPORT\nReported on: 20/05/2026\nA 2.1 cm tumour with ill-defined margins is seen on gross examination.'), 'margins_documented')).toEqual([])
  })
  it('still keeps a stated margin result', () => {
    expect(quotes(run('pathology_report', 'LAB\nHISTOPATHOLOGY REPORT\nReported on: 20/05/2026\nAll surgical margins are free of tumour. The closest margin is 0.4 cm away.'), 'margins_documented')).toHaveLength(2)
  })
  it('files no radiotherapy record from a history sentence in a scan report', () => {
    expect(of(run('imaging_report', MR), 'radiotherapy_documented')).toEqual([])
    expect(of(run('imaging_report', 'CENTRE\nPET-CT WHOLE BODY\nDate of study: 02/09/2026\nClinical history: Carcinoma breast, received radiotherapy completed in March 2024.\nFindings\nPost radiotherapy changes in the left breast.'), 'radiotherapy_documented')).toEqual([])
  })
  it('still reads a radiotherapy summary', () => {
    expect(of(run('radiotherapy_summary', 'CENTRE\nRADIOTHERAPY SUMMARY\nRadiotherapy completed on 12/03/2026.'), 'radiotherapy_documented')).toHaveLength(1)
  })
})

describe('impressions are whole', () => {
  it('keeps the whole impression across a blank line and a long block, as quotes that end at a full stop', () => {
    const q = quotes(run('imaging_report', MR), 'impression_documented')
    expect(q.length).toBeGreaterThanOrEqual(2)
    expect(q.every((x) => /[.]$/.test(x))).toBe(true)
    const all = q.join(' ')
    expect(all).toContain('Solitary enhancing right frontal lesion')
    expect(all).toContain('Correlation with clinical findings is advised.')
    expect(all).not.toMatch(/Test Reader|Report status|Electronically/)
  })
  it('does not cut a sentence that wraps over a blank line', () => {
    const g = run('imaging_report', 'CENTRE\nCT ABDOMEN\nDate of study: 02/09/2026\nIMPRESSION:\nHypodense liver lesion in segment VII measuring about 2 cm, suspicious for\n\nmetastasis. Follow-up advised.\nDr. A B')
    expect(quotes(g, 'impression_documented')).toEqual(['IMPRESSION: Hypodense liver lesion in segment VII measuring about 2 cm, suspicious for metastasis. Follow-up advised.'])
  })
  it('stops at the next heading', () => {
    const g = run('imaging_report', 'CENTRE\nCT ABDOMEN\nDate of study: 02/09/2026\nImpression: Mild ascites.\n\nRecommendation: repeat scan in 3 months.')
    expect(quotes(g, 'impression_documented')).toEqual(['Impression: Mild ascites.'])
  })
})

describe('no signature block or footer in a quote', () => {
  it('cuts a physician name and a report status off the end of a line', () => {
    const g = run('imaging_report', 'CENTRE\nCT CHEST\nDate of study: 02/09/2026\nImpression: Right upper zone opacity. CT chest advised.  Dr. Test Reader   Report status: Final')
    expect(quotes(g, 'impression_documented').join(' ')).not.toMatch(/Dr\.|Report status/)
  })
  it('keeps a doctor named inside a sentence', () => {
    const g = run('consult_note', 'CLINIC\nCONSULTATION NOTE\nDate of visit: 14-04-2026\nReferred to Dr. Meera Rao for radiotherapy opinion on 20/04/2026.')
    expect(quotes(g, 'referral_documented')).toEqual(['Referred to Dr. Meera Rao for radiotherapy opinion on 20/04/2026.'])
  })
  it('never lets a signature line or footer into any accepted quote', () => {
    for (const a of run('imaging_report', MR).accepted) expect(a.evidence.quote).not.toMatch(/Electronically|Report status|Test Reader/)
  })
})

describe('a referenced earlier study keeps its own date', () => {
  it('dates "prior MRI dated 12 Feb 2025" by that study, not by the study being reported', () => {
    const g = run('imaging_report', 'CENTRE\nCT CHEST\nDate of study: 02/09/2026\nCT chest of 02/09/2026 is compared with previous CT of 26 Aug 2025 and prior MRI dated 12 Feb 2025.')
    const dates = of(g, 'imaging_report_documented').map((a) => `${a.candidate.fields.test_name}|${a.candidate.fields.event_date_text}`)
    expect(dates).toEqual(expect.arrayContaining(['CT|26 Aug 2025', 'MRI|12 Feb 2025']))
  })
})
