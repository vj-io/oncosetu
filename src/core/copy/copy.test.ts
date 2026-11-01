import { describe, expect, it } from 'vitest'
import { brandFor, formatDateIN, istDate, lintText, patientDocLabel, staffDocLabel } from '.'

const terms = (text: string, rs: Parameters<typeof lintText>[1]) => lintText(text, rs).map((h) => h.match)

describe('lintText', () => {
  it.each([
    ['Biopsy report not in file', ['Biopsy']],
    ['Your cancer care team', ['cancer']],
    ['Oncology OPD', ['Oncology']],
    ['OncoSetu', ['OncoSetu']],
    ['metastatic disease', ['metastatic']],
    ['Chemotherapy day 1', ['Chemotherapy']],
    ['malignancy ruled out', ['malignancy']],
    ['tumour board', ['tumour']],
    ['Stage II', ['Stage']],
    ['IHC pending', ['IHC']],
    ['कैंसर की रिपोर्ट', ['कैंसर']],
    ['कीमोथेरेपी का रिकॉर्ड', ['कीमोथेरेपी']],
    ['आपकी बायोप्सी', ['बायोप्सी']],
  ])('diagnosis: %s', (text, expected) => {
    expect(terms(text, ['diagnosis'])).toEqual(expected)
  })

  it.each([
    'Your reports are ready',
    'Upgrade your app', // "grade" inside a word
    'Backstage pass', // "stage" inside a word
    'Your treatment documents',
    'Laboratory report (tissue)',
    'Setu Records',
    'Day-care record',
    'Radiology department', // not "radiation"/"radiotherapy"
    'आपकी रिपोर्ट तैयार है',
    'प्रयोगशाला रिपोर्ट (ऊतक)',
  ])('diagnosis clean: %s', (text) => {
    expect(terms(text, ['diagnosis'])).toEqual([])
  })

  it.each([
    ['This needs attention', ['needs']],
    ['You should get a scan', ['should']],
    ['Urgent: report missing', ['Urgent']],
    ['concerning finding', ['concerning']],
    ['abnormality seen', ['abnormality']],
    ['signs of progression', ['progression']],
    ['getting worse', ['worse']],
    ['high risk', ['risk']],
    ['We recommend a test', ['recommend']],
    ['recommendation follows', ['recommendation']],
    ['आपको जांच करानी चाहिए', ['चाहिए']],
    ['तुरंत संपर्क करें', ['तुरंत']],
  ])('radar: %s', (text, expected) => {
    expect(terms(text, ['radar'])).toEqual(expected)
  })

  it.each(['Request in progress', 'Needle-free', 'Histopathology report not in file for the procedure documented on 12 Mar 2026'])(
    'radar clean: %s',
    (text) => expect(terms(text, ['radar'])).toEqual([]),
  )

  it('legal phrases', () => {
    expect(terms('The hospital must reply', ['legal'])).toEqual(['must'])
    expect(terms('They are legally   required to send it', ['legal'])).toEqual(['legally   required to'])
    expect(terms('within 72 hours you will', ['legal'])).toEqual(['within 72 hours you'])
    expect(terms('mustard', ['legal'])).toEqual([])
  })

  it('reports ruleset, term and index; sorted by position', () => {
    const hits = lintText('urgent cancer', ['diagnosis', 'radar'])
    expect(hits.map((h) => [h.ruleset, h.term, h.index])).toEqual([
      ['radar', 'urgent', 0],
      ['diagnosis', 'cancer*', 7],
    ])
  })

  it('matches decomposed nukta forms (NFC)', () => {
    expect(terms('ज़रूरी', ['radar'])).toEqual(['ज़रूरी'])
  })
})

describe('labels and brand', () => {
  it('neutral labels unless cleared', () => {
    expect(patientDocLabel('chemo_daycare_record', 'unknown')).toBe('Day-care record')
    expect(patientDocLabel('pathology_report', 'not_cleared')).toBe('Laboratory report (tissue)')
    expect(patientDocLabel('pathology_report', 'cleared')).toBe('Histopathology report')
    expect(patientDocLabel('radiotherapy_summary', 'unknown', 'hi')).toBe('उपचार सारांश')
    expect(staffDocLabel('chemo_daycare_record')).toBe('Chemotherapy day-care record')
  })
  it('brand', () => {
    expect(brandFor('cleared')).toBe('OncoSetu')
    expect(brandFor('unknown')).toBe('Setu Records')
    expect(brandFor('not_cleared')).toBe('Setu Records')
  })
})

describe('formatDateIN', () => {
  it.each([
    ['2026-03-12', 'en', 'day', '12 Mar 2026'],
    ['2026-03-12', 'hi', 'day', '12 मार्च 2026'],
    ['2026-03-01', 'en', 'month', 'Mar 2026'],
    ['2026-01-01', 'en', 'year', '2026'],
    [null, 'en', 'day', 'date not stated'],
    ['2026-03-11T20:00:00Z', 'en', 'day', '12 Mar 2026'], // IST is +05:30
  ] as const)('%s %s %s', (iso, lang, precision, expected) => {
    expect(formatDateIN(iso, lang, precision)).toBe(expected)
  })
  it('istDate', () => {
    expect(istDate('2026-03-11T18:29:00Z')).toBe('2026-03-11')
    expect(istDate('2026-03-11T18:30:00Z')).toBe('2026-03-12')
  })
})
