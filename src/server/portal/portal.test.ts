// FR-CON-07 / FR-VOX-04..07 for the patient portal: every sentence built for a patient who has not been told contains no
// diagnosis word and no "Onco"; the read-back keeps the patient's words and never invents a date.
import { describe, expect, it } from 'vitest'
import { brandFor, consentFormLabel, lintText, patientDocLabel } from '@/core/copy'
import { DOC_TYPES, type Disclosure, type Lang } from '@/core/types'
import { en, hi, hinglish, tp, tpw, type PatientKey } from '@/i18n/patient'
import { pickLang } from './lang'
import { classifyAction, deviceOf, staffWho } from './access'
import { buildHomeSummary, guardText, isPastDate, labelWithoutDates, type HomeData } from './summary'
import { openShadow, sealShadow } from './statements'
import { answersFor, answersSchema, buildReadback, enabledQuestions, missingQuestion, questionSettings, QUESTION_IDS, statedDate, transcriptOf, type Answers } from './visit-model'

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
  today: '2026-03-10',
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
    { id: 'f5', what: 'Suture removal', date: '2026-03-24', precision: 'day', docType: 'consult_note' }, // the same date and words from another paper
    { id: 'f6', what: '02/02/2026', date: '2026-02-02', precision: 'day', docType: 'consult_note' }, // a raw date used as its own label
    { id: 'f7', what: '23/04/2026 — Next visit', date: '2026-04-23', precision: 'day', docType: 'consult_note' },
    { id: 'f8', what: 'Dressing change', date: '2026-03-02', precision: 'day', docType: 'consult_note' }, // already past
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
  it('says which paper mentions a missing one, so look-alike cards can be told apart (PAT-03)', () => {
    const row = { ...home.looking[0], source: { docType: 'discharge_summary' as const, date: '2026-01-20' } }
    for (const disclosure of NOT_TOLD) for (const lang of LANGS) expect(dirty(strings(buildHomeSummary({ ...home, looking: [row] }, disclosure, lang)))).toEqual([])
    expect(buildHomeSummary({ ...home, looking: [row] }, 'not_cleared', 'en').looking[0].mentionedIn).toMatch(/^Mentioned in your .+, 20 Jan 2026$/)
    expect(buildHomeSummary({ ...home, looking: [{ ...row, source: { docType: 'discharge_summary', date: null } }] }, 'not_cleared', 'en').looking[0].mentionedIn).toMatch(/^Mentioned in your [^,]+$/)
    expect(buildHomeSummary(home, 'not_cleared', 'en').looking[0].mentionedIn).toBeNull()
  })

  it('gives an arrived paper a date and a place, and never a diagnosis word for an undisclosed patient', () => {
    const row = { ...home.looking[0], state: 'received' as const, institution: 'City Care Hospital', source: { docType: 'discharge_summary' as const, date: '2026-01-20' } }
    const l = buildHomeSummary({ ...home, looking: [row] }, 'not_cleared', 'en').looking[0]
    expect(l.place).toBe('At: City Care Hospital')
    expect(l.when).toMatch(/2026/)
    const risky = buildHomeSummary({ ...home, looking: [{ ...row, institution: 'Tata Cancer Hospital' }] }, 'not_cleared', 'en').looking[0]
    expect(dirty([risky.place ?? ''])).toEqual([])
    for (const lang of LANGS) expect(dirty(strings(buildHomeSummary({ ...home, looking: [{ ...row, institution: 'Cancer Centre' }] }, 'not_cleared', lang)))).toEqual([])
  })

  it('lists a missing paper as a neutral document with its date', () => {
    const s = buildHomeSummary(home, 'not_cleared', 'en')
    expect(s.looking[0]).toMatchObject({ label: 'Laboratory report (tissue)', when: 'From around 12 Mar 2026', status: 'Not in your file yet', canLetter: true })
    expect(s.looking[1]).toMatchObject({ when: 'From around Mar 2026', canLetter: false })
    expect(s.looking[1].label).toBe('Laboratory report (additional tests) or Laboratory report')
    expect(s.looking[2]).toMatchObject({ label: 'Treatment summary or Day-care record', when: null, status: 'Received. The clinic team will check it.', canLetter: false })
    expect(s.documents.find((d) => d.id === 'dx')?.label).toBe('Document (being checked)')
  })

  it('never shows "(printed)", "(handwritten)" or a "/" between alternatives to a family', () => {
    const s = buildHomeSummary({ ...home, looking: [{ id: 'rx', expectedTypes: ['prescription_printed', 'prescription_handwritten'], state: 'expected', date: '2026-05-01', precision: 'month', institution: null }] }, 'not_cleared', 'en')
    expect(s.looking[0].label).toBe('Prescription')
    expect(buildHomeSummary({ ...home, looking: [{ ...home.looking[0], expectedTypes: ['prescription_handwritten'] }] }, 'cleared', 'hi').looking[0].label).toBe('पर्चा')
    for (const row of buildHomeSummary(home, 'not_cleared', 'en').looking) expect(row.label).not.toMatch(/\((?:printed|handwritten)\)| \/ /)
  })

  it('sorts papers by the paper\'s own date, newest first', () => {
    const docs = [
      { id: 'a', docType: 'lab_report' as const, documentDate: '2026-03-28', receivedAt: '2026-06-03T04:00:00.000Z' },
      { id: 'b', docType: 'lab_report' as const, documentDate: '2024-11-18', receivedAt: '2026-06-04T04:00:00.000Z' },
      { id: 'c', docType: 'lab_report' as const, documentDate: '2026-06-03', receivedAt: '2026-06-05T04:00:00.000Z' },
      { id: 'd', docType: 'lab_report' as const, documentDate: '2026-02-20', receivedAt: '2026-06-05T05:00:00.000Z' },
    ]
    expect(buildHomeSummary({ ...home, documents: docs }, 'not_cleared', 'en').documents.map((d) => d.id)).toEqual(['c', 'a', 'd', 'b'])
  })

  it('writes each written date once, with no raw date as its label, upcoming first and past dates apart', () => {
    for (const lang of LANGS) {
      const s = buildHomeSummary(home, 'not_cleared', lang)
      const all = [...s.coming, ...s.earlier]
      const keys = all.map((r) => `${r.date}|${r.what}`)
      expect(new Set(keys).size).toBe(keys.length)
      for (const r of all) expect(r.what).not.toMatch(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/)
    }
    const s = buildHomeSummary(home, 'not_cleared', 'en')
    expect(s.coming.map((d) => `${d.date}: ${d.what}`)).toEqual([
      '20 Mar 2026: A date written in your papers', '24 Mar 2026: Suture removal', '23 Apr 2026: Next visit',
      '26 Jun 2026: A date written in your papers', // a treatment cycle is not named to a patient who has not been told
    ])
    expect(s.earlier.map((d) => `${d.date}: ${d.what}`)).toEqual(['2 Mar 2026: Dressing change', '2 Feb 2026: A date written in your papers'])
  })

  it('keeps a month or a year in "coming up" until it is over', () => {
    expect(isPastDate('2026-03-01', 'month', '2026-03-31')).toBe(false)
    expect(isPastDate('2026-03-01', 'month', '2026-04-01')).toBe(true)
    expect(isPastDate('2026-01-01', 'year', '2026-12-31')).toBe(false)
    expect(isPastDate('2026-03-10', 'day', '2026-03-10')).toBe(false)
    expect(isPastDate('2026-03-09', 'day', '2026-03-10')).toBe(true)
  })

  it('strips dates out of a label copied from a paper', () => {
    expect(labelWithoutDates('02/02/2026')).toBe('')
    expect(labelWithoutDates('23/04/2026 — 23 Apr 2026')).toBe('')
    expect(labelWithoutDates('Next visit on 2 Jun 2026')).toBe('Next visit')
    expect(labelWithoutDates('Suture removal 24/03')).toBe('Suture removal')
    expect(labelWithoutDates('Review after 2 weeks')).toBe('Review after 2 weeks')
    expect(labelWithoutDates(null)).toBe('')
  })

  it('says where to ask, the dates already written down and the doctor the latest papers name — as written', () => {
    const s = buildHomeSummary(home, 'not_cleared', 'en')
    expect(s.looking.map((l) => l.ask)).toEqual(['Ask at: Triveni Multispeciality Hospital', null, null, null]) // "Cancer" in a name is not shown
    expect(s.coming[1].source).toBe('From: Hospital discharge summary')
    expect(s.doctor).toBe('Doctor named on your latest papers: Dr. R. S. Joglekar (Day-care record, 5 Jun 2026)')
    const told = buildHomeSummary(home, 'cleared', 'en')
    expect(told.coming[0]).toMatchObject({ date: '20 Mar 2026', what: 'Review in the Surgical Oncology OPD' })
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

  it('speaks about the patient by name when a family member answers, and never says "you" for them', () => {
    for (const lang of LANGS) {
      const r = buildReadback(answers, lang, QUESTION_IDS, 'Sunita')
      expect(r.intro).toContain('Sunita')
      for (const l of r.lines.filter((x) => x.q !== 'anything_else')) expect(l.text).toContain('Sunita')
      expect(dirty([r.intro, ...r.lines.map((l) => l.text)])).toEqual([])
    }
    expect(tpw('en', 'q_new_tests', 'Sunita')).toBe('Has Sunita had any new tests or scans?')
    expect(tpw('en', 'q_new_tests', null)).toBe('Have you had any new tests or scans?')
    expect(tpw('hi', 'homeKicker', 'Sunita')).toBe('Sunita की फ़ाइल')
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

describe('configurable questions (FR-VOX-01)', () => {
  const ok: Answers = { other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' } }
  const setting = [
    { id: 'anything_else', on: true }, { id: 'new_tests', on: true }, { id: 'admissions', on: false }, { id: 'other_hospital', on: true }, { id: 'new_medicines', on: true },
  ]
  it('asks the switched-on questions in the org order; no setting is the default five', () => {
    expect(enabledQuestions(null)).toEqual(QUESTION_IDS)
    expect(enabledQuestions(setting)).toEqual(['anything_else', 'new_tests', 'other_hospital', 'new_medicines'])
    expect(questionSettings(setting).map((q) => q.id)).toEqual(['anything_else', 'new_tests', 'admissions', 'other_hospital', 'new_medicines'])
    // unknown ids are ignored, a question the setting leaves out stays on (at the end), all-off falls back to all five
    expect(enabledQuestions([{ id: 'bogus', on: true }, { id: 'admissions', on: true }])).toEqual(['admissions', 'other_hospital', 'new_medicines', 'new_tests', 'anything_else'])
    expect(enabledQuestions(QUESTION_IDS.map((id) => ({ id, on: false })))).toEqual(QUESTION_IDS)
  })
  it('a switched-off question is not required; anything else stays optional wherever it is', () => {
    const asked = enabledQuestions(setting)
    const withoutAdmissions: Answers = { ...ok, admissions: undefined }
    expect(answersFor(asked).safeParse(withoutAdmissions).success).toBe(true)
    expect(answersSchema.safeParse(withoutAdmissions).success).toBe(false)
    expect(missingQuestion(withoutAdmissions, asked)).toBeNull()
    expect(missingQuestion({ ...withoutAdmissions, new_tests: undefined }, asked)).toBe('new_tests')
    expect(answersFor([]).safeParse({ anything_else: { yn: 'yes' } }).success).toBe(false) // words still required with yes
  })
  it('reads back in the order asked', () => {
    const rb = buildReadback({ ...ok, anything_else: { yn: 'yes', free: 'Knee pain' } }, 'en', enabledQuestions(setting))
    expect(rb.lines.map((l) => l.q)).toEqual(['anything_else', 'new_tests', 'other_hospital', 'new_medicines'])
  })
})

describe('voice shadow tokens (FR-VOX-03)', () => {
  it('seal what was heard so the browser cannot read it; only this server opens it', () => {
    process.env.APP_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64')
    const token = sealShadow({ clipId: 'c1', patientId: 'p1', text: 'Tab Capecitabine 500' })
    expect(token).not.toContain('Capecitabine')
    expect(openShadow(token)).toEqual({ clipId: 'c1', patientId: 'p1', text: 'Tab Capecitabine 500' })
    expect(openShadow(`${token.slice(0, -2)}AA`)).toBeNull()
    expect(openShadow('not a token')).toBeNull()
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

describe('language choice (PAT-01)', () => {
  it('the address wins, then the remembered choice, then the fallback', () => {
    expect(pickLang('en', 'hi', 'hi')).toBe('en')
    expect(pickLang(null, 'hinglish', 'hi')).toBe('hinglish')
    expect(pickLang(null, undefined, 'hi')).toBe('hi')
    expect(pickLang(null, 'fr', 'en')).toBe('en')
  })
})

describe('patient surfaces: privacy and labels', () => {
  it.each(LANGS)('lists the signed consent form by name, not "Other document" (%s)', (lang) => {
    for (const disclosure of ['cleared', 'not_cleared'] as const) {
      const docs = [
        { id: 'cf', docType: 'other' as const, documentDate: null, receivedAt: '2026-11-02T04:44:00.000Z', consentForm: 'sign' as const },
        { id: 'wd', docType: 'other' as const, documentDate: null, receivedAt: '2026-11-02T04:45:00.000Z', consentForm: 'withdraw' as const },
        { id: 'ot', docType: 'other' as const, documentDate: null, receivedAt: '2026-11-02T04:46:00.000Z' },
      ]
      const s = buildHomeSummary({ ...home, documents: docs }, disclosure, lang)
      const by = (id: string) => s.documents.find((d) => d.id === id)!.label
      expect(by('cf')).toBe(consentFormLabel(lang, 'sign'))
      expect(by('wd')).toBe(consentFormLabel(lang, 'withdraw'))
      expect(by('ot')).toBe(patientDocLabel('other', disclosure, lang))
      expect(by('cf')).not.toBe(by('ot'))
    }
    expect(consentFormLabel('en')).toBe('Signed consent form')
  })

  it('a paper is listed by its kind and dates only: no field carries a file name', () => {
    const s = buildHomeSummary({ ...home, documents: [{ id: 'x', docType: 'imaging_report', documentDate: '2026-03-12', receivedAt: '2026-11-02T04:44:00.000Z', fileName: 'RAMESH_KUMAR_PET_report.pdf' } as HomeData['documents'][number]] }, 'not_cleared', 'en')
    expect(Object.keys(s.documents[0]).sort()).toEqual(['dated', 'disputed', 'id', 'label', 'open', 'received'])
    expect(s.documents[0].open).toBe(false) // only a yes/no: the link is built from the id
    expect(JSON.stringify(s)).not.toMatch(/RAMESH|\.pdf/)
  })

  it('written dates drop a physician name and a signature line', () => {
    const rows = [
      { id: 'w1', what: 'Review with Dr. Anil Mehta', date: '2026-04-02', precision: 'day' as const, docType: 'consult_note' as const },
      { id: 'w2', what: 'Signed by Dr. Anil Mehta', date: '2026-04-09', precision: 'day' as const, docType: 'consult_note' as const },
    ]
    for (const lang of LANGS) {
      const s = buildHomeSummary({ ...home, writtenDates: rows }, 'not_cleared', lang)
      expect(JSON.stringify(s)).not.toMatch(/Mehta|Signed by/)
    }
  })
})
