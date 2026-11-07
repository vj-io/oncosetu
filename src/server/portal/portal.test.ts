// FR-CON-07 / FR-VOX-04..07 for the patient portal: every sentence built for a patient who has not been told contains no
// diagnosis word and no "Onco"; the read-back keeps the patient's words and never invents a date.
import { describe, expect, it } from 'vitest'
import { brandFor, lintText } from '@/core/copy'
import { DOC_TYPES, type Disclosure, type Lang } from '@/core/types'
import { en, hi, hinglish, tp, type PatientKey } from '@/i18n/patient'
import { classifyAction, deviceOf, staffWho } from './access'
import { buildHomeSummary, guardText, type HomeData } from './summary'
import { answersSchema, buildReadback, QUESTION_IDS, statedDate, transcriptOf, type Answers } from './visit-model'

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
const dirty = (texts: string[]) => texts.flatMap((t) => [...lintText(t, ['diagnosis', 'radar']).map((h) => `${h.match} in "${t}"`), ...(/onco/i.test(t) ? [`Onco in "${t}"`] : [])])
const LANGS: Lang[] = ['en', 'hi', 'hinglish']
const NOT_TOLD: Disclosure[] = ['not_cleared', 'unknown']

const home: HomeData = {
  documents: [
    ...DOC_TYPES.map((t, i) => ({ id: `d${i}`, docType: t, documentDate: '2026-03-12', receivedAt: '2026-11-02T04:44:00.000Z' })),
    { id: 'dx', docType: null, documentDate: null, receivedAt: '2026-11-02T04:44:00.000Z' },
  ],
  looking: [
    { id: 'm1', expectedTypes: ['pathology_report'], state: 'expected', date: '2026-03-12', precision: 'day', institution: 'Triveni Multispeciality Hospital' },
    { id: 'm2', expectedTypes: ['ihc_molecular_report', 'lab_report'], state: 'requested', date: '2026-03-01', precision: 'month', institution: 'Regional Cancer Centre' },
    { id: 'm3', expectedTypes: ['radiotherapy_summary', 'chemo_daycare_record'], state: 'received', date: null, precision: 'unknown', institution: null },
    { id: 'm4', expectedTypes: [], state: 'expected', date: '2026-01-01', precision: 'year', institution: null },
  ],
  writtenDates: [
    { id: 'f1', what: 'Review in the Surgical Oncology OPD', date: '2026-03-20', precision: 'day', docType: 'discharge_summary' },
    { id: 'f2', what: 'Suture removal', date: '2026-03-24', precision: 'day', docType: 'discharge_summary' },
    { id: 'f3', what: 'Next cycle of chemotherapy', date: '2026-06-26', precision: 'day', docType: 'chemo_daycare_record' },
    { id: 'f4', what: 'Next visit: Cycle 5', date: '2026-06-26', precision: 'day', docType: 'chemo_daycare_record' },
  ],
  doctor: { name: 'Dr. R. S. Joglekar', docType: 'chemo_daycare_record', date: '2026-06-05' },
  openRequests: 2,
  lastStatement: { at: '2026-10-30T10:00:00.000Z', confirmed: false },
  activeShares: 1,
}

const answers: Answers = {
  other_hospital: { yn: 'yes', place: 'City Hospital, Dr Rao', month: 3, year: 2026, whenText: '3 weeks back' },
  new_medicines: { yn: 'yes', names: 'Paracetamol 500, Pantoprazole', place: 'Dr Rao' },
  new_tests: { yn: 'yes', testKind: 'scan', names: 'CT scan of the chest', place: 'Sunrise Imaging', year: 2026 },
  admissions: { yn: 'yes', place: 'Lakeview Hospital', month: 9, year: 2026 },
  anything_else: { yn: 'yes', free: 'My mother gets dizzy in the mornings' },
}

describe('patient catalogue', () => {
  it('has the same keys and the same {tokens} in English, Hindi and Hinglish', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(hinglish).sort()).toEqual(Object.keys(en).sort())
    const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const k of Object.keys(en) as PatientKey[]) {
      expect(`${k}:${tokens(hi[k])}`).toBe(`${k}:${tokens(en[k])}`)
      expect(`${k}:${tokens(hinglish[k])}`).toBe(`${k}:${tokens(en[k])}`)
    }
  })

  it('is free of diagnosis words, radar words and the brand name', () => {
    expect(dirty([...Object.values(en), ...Object.values(hi), ...Object.values(hinglish)])).toEqual([])
  })
})

describe.each(NOT_TOLD)('home summary, disclosure %s', (disclosure) => {
  it.each(LANGS)('has zero diagnosis words and no "Onco" (%s)', (lang) => {
    const s = buildHomeSummary(home, disclosure, lang)
    expect(strings(s).length).toBeGreaterThan(20)
    expect(dirty(strings(s))).toEqual([])
    expect(brandFor(disclosure)).toBe('Setu Records')
  })
})

describe('home summary wording', () => {
  it('lists a missing paper as a neutral document with its date', () => {
    const s = buildHomeSummary(home, 'not_cleared', 'en')
    expect(s.looking[0].text).toBe('Laboratory report (tissue) linked to 12 Mar 2026 — not yet in your file')
    expect(s.looking[1].text).toContain('linked to Mar 2026')
    expect(s.looking[2].text).toBe('Treatment summary / Day-care record — received, the clinic team will check it')
    expect(s.documents.at(-1)?.label).toBe('Document (being checked)')
  })

  it('says where to ask, the dates already written down and the doctor the latest papers name — as written', () => {
    const s = buildHomeSummary(home, 'not_cleared', 'en')
    expect(s.looking.map((l) => l.ask)).toEqual(['Ask at: Triveni Multispeciality Hospital', null, null, null]) // "Cancer" in a name is not shown
    expect(s.writtenDates.map((d) => d.text)).toEqual([
      'A date written in your papers — 20 Mar 2026', 'Suture removal — 24 Mar 2026', 'A date written in your papers — 26 Jun 2026',
      'A date written in your papers — 26 Jun 2026', // a treatment cycle is not named to a patient who has not been told
    ])
    expect(s.writtenDates[1].source).toBe('From: Hospital discharge summary')
    expect(s.doctor).toBe('Doctor named on your latest papers: Dr. R. S. Joglekar (Day-care record, 5 Jun 2026)')
    const told = buildHomeSummary(home, 'cleared', 'en')
    expect(told.writtenDates[0].text).toBe('Review in the Surgical Oncology OPD — 20 Mar 2026')
    expect(told.looking[1].ask).toBe('Ask at: Regional Cancer Centre')
  })

  it('may use clinical labels only when cleared', () => {
    expect(buildHomeSummary(home, 'cleared', 'en').documents.some((d) => d.label === 'Histopathology report')).toBe(true)
    expect(buildHomeSummary(home, 'unknown', 'en').documents.some((d) => d.label === 'Histopathology report')).toBe(false)
  })

  it('replaces server text that holds a diagnosis word (for example a hospital name) unless cleared', () => {
    expect(guardText('Sunrise Cancer Centre', 'not_cleared', 'another hospital')).toBe('another hospital')
    expect(guardText('Sunrise Cancer Centre', 'cleared', 'another hospital')).toBe('Sunrise Cancer Centre')
    expect(guardText('City Hospital', 'unknown', 'another hospital')).toBe('City Hospital')
    expect(guardText('  ', 'cleared', 'another hospital')).toBe('another hospital')
  })
})

describe('read-back (FR-VOX-04)', () => {
  it.each(LANGS)('for a not_cleared patient has zero diagnosis words and no "Onco" (%s)', (lang) => {
    const variants: Answers[] = [
      answers,
      Object.fromEntries(QUESTION_IDS.map((q) => [q, { yn: 'no' }])) as Answers,
      Object.fromEntries(QUESTION_IDS.map((q) => [q, { yn: q === 'anything_else' ? 'no' : 'unsure' }])) as Answers,
      Object.fromEntries(QUESTION_IDS.map((q) => [q, { yn: 'yes' }])) as Answers, // yes without details → "plain" sentences
      { ...answers, new_tests: { yn: 'yes', testKind: 'blood' }, other_hospital: { yn: 'yes', whenText: 'last month' } },
    ]
    for (const a of variants) {
      const r = buildReadback(a, lang)
      expect(r.lines.length).toBeGreaterThan(0)
      expect(dirty([r.intro, ...r.lines.map((l) => l.text)])).toEqual([])
    }
  })

  it('shows what the patient said, with month/year dates formatted and relative phrases kept verbatim', () => {
    const r = buildReadback(answers, 'en')
    expect(r.lines.find((l) => l.q === 'other_hospital')?.text).toBe('You saw another hospital or doctor: City Hospital, Dr Rao, Mar 2026 · “3 weeks back”.')
    expect(r.lines.find((l) => l.q === 'new_medicines')?.text).toBe('You were given new medicines: Paracetamol 500, Pantoprazole, Dr Rao.')
    expect(r.lines.find((l) => l.q === 'anything_else')?.text).toBe('You want the doctor to know: “My mother gets dizzy in the mornings”')
    expect(buildReadback(answers, 'hi').lines.find((l) => l.q === 'admissions')?.text).toBe('आप किसी अस्पताल में भर्ती रहे हैं: Lakeview Hospital, सितंबर 2026।')
    // voice typing returns a sentence with its own full stop; the read-back adds exactly one
    const spoken: Answers = { new_medicines: { yn: 'yes', names: 'Tab Ondansetron chaar mg subah shaam.' } }
    expect(buildReadback(spoken, 'en').lines[0].text).toBe('You were given new medicines: Tab Ondansetron chaar mg subah shaam.')
    expect(buildReadback(spoken, 'hi').lines[0].text).toBe('आपको नई दवाइयाँ दी गई हैं: Tab Ondansetron chaar mg subah shaam।')
  })

  it('never turns a relative date into a date (E-DOC-13) and uses month/year only when the patient picked them', () => {
    expect(statedDate({ yn: 'yes', whenText: '3 weeks back' })).toBeNull()
    expect(statedDate({ yn: 'yes', month: 3, year: 2026 })).toEqual({ iso: '2026-03-01', precision: 'month' })
    expect(statedDate({ yn: 'yes', year: 2025 })).toEqual({ iso: '2025-01-01', precision: 'year' })
    expect(transcriptOf('other_hospital', { yn: 'yes', place: 'City Hospital', whenText: '3 weeks back' }, 'en')).toBe('City Hospital; 3 weeks back')
    expect(transcriptOf('anything_else', { yn: 'yes', free: '  words as typed  ' }, 'en')).toBe('words as typed')
  })
})

describe('answers schema', () => {
  const ok: Answers = { other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' } }
  it('needs the first four answers; "anything else" is optional but needs words when yes', () => {
    expect(answersSchema.safeParse(ok).success).toBe(true)
    expect(answersSchema.safeParse({ ...ok, new_tests: undefined }).success).toBe(false)
    expect(answersSchema.safeParse({ ...ok, anything_else: { yn: 'yes' } }).success).toBe(false)
    expect(answersSchema.safeParse({ ...ok, anything_else: { yn: 'yes', free: 'something' } }).success).toBe(true)
    expect(answersSchema.safeParse({ ...ok, anything_else: { yn: 'no' } }).success).toBe(true)
  })
  it('needs a year with a month and rejects out-of-range values', () => {
    expect(answersSchema.safeParse({ ...ok, admissions: { yn: 'yes', month: 3 } }).success).toBe(false)
    expect(answersSchema.safeParse({ ...ok, admissions: { yn: 'yes', month: 13, year: 2026 } }).success).toBe(false)
    expect(answersSchema.safeParse({ ...ok, admissions: { yn: 'yes', month: 3, year: 2026 } }).success).toBe(true)
    expect(answersSchema.safeParse({ ...ok, admissions: { yn: 'maybe' } }).success).toBe(false)
  })
})

describe('access log wording', () => {
  it('classifies audit actions by kind only', () => {
    expect(classifyAction('break_glass.open', 'patient')).toBe('emergency')
    expect(classifyAction('snapshot.export', 'patient')).toBe('exported')
    expect(classifyAction('document.view_source', 'document')).toBe('viewed_document')
    expect(classifyAction('patient.lookup', 'patient')).toBe('viewed')
    expect(classifyAction('event.verify', 'event')).toBe('other')
  })
  it('reads as plain sentences in both languages', () => {
    for (const lang of LANGS) {
      const rows = (['desk', 'records', 'clinician', 'org_admin', 'auditor'] as const).flatMap((role) =>
        (['emergency', 'exported', 'viewed_document', 'viewed', 'other'] as const).map((k) => tp(lang, `acc_${k}` as PatientKey, { who: staffWho(role, lang) })))
      expect(dirty(rows)).toEqual([])
    }
    expect(tp('en', 'acc_viewed_document', { who: staffWho('records', 'en') })).toBe('Clinic staff (Records) viewed a document')
  })
  it('keeps only a coarse device word from a user agent', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('phone')
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet')
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('computer')
    expect(deviceOf(null)).toBe('unknown')
  })
})
