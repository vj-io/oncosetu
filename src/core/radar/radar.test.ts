import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lintText } from '../copy'
import type { CoreDocument, CoreEvent, CoreStatement, DocType, EventType, FieldValue } from '../types'
import { dedupeKeyFor, formatCycleList, loadRules, RADAR_RULES, RULES_YAML, runRadar, transitionMissing, type RadarInput } from '.'

const NOW = '2026-11-02T06:00:00Z'

let seq = 0
const ev = (eventType: EventType, fields: Record<string, FieldValue>, eventDate: string | null, documentId: string | null, extra: Partial<CoreEvent> = {}): CoreEvent => ({
  id: extra.id ?? `e${String(++seq).padStart(3, '0')}`,
  eventType,
  fields,
  eventDate,
  datePrecision: eventDate ? 'day' : 'unknown',
  documentDate: null,
  receivedAt: '2026-10-01T10:00:00Z',
  documentId,
  sourceType: 'external_document',
  extractionMethod: 'text_layer',
  verificationStatus: 'unverified',
  flags: [],
  version: 1,
  evidence: [{ documentId, pageNo: 2, charStart: 0, charEnd: 10, quote: 'x', quoteSha256: 'h' }],
  ...extra,
})
const doc = (id: string, docType: DocType, documentDate: string | null, institution: string | null = 'City Cancer Hospital', extra: Partial<CoreDocument> = {}): CoreDocument => ({
  id,
  docType,
  documentDate,
  receivedAt: '2026-10-01T10:00:00Z',
  institution,
  ...extra,
})
const stmt = (id: string, extra: Partial<CoreStatement>): CoreStatement => ({
  id,
  questionId: 'new_tests',
  transcript: 'I had a scan at another hospital',
  language: 'en',
  confirmation: 'patient_confirmed',
  capturedAt: '2026-10-20T05:00:00Z',
  ...extra,
})
const run = (p: Partial<RadarInput>) => runRadar({ events: [], documents: [], statements: [], now: NOW, ...p })

const DS = doc('d-ds', 'discharge_summary', '2026-03-16')
const WLE = ev('procedure_documented', { procedure_text: 'wide local excision', institution_name: 'City Cancer Hospital' }, '2026-03-12', 'd-ds', { id: 'e-wle' })

describe('rule library', () => {
  it('rules.yaml and RULES_YAML are identical (runtime needs no fs)', () => {
    expect(readFileSync(new URL('./rules.yaml', import.meta.url), 'utf8')).toBe(RULES_YAML)
  })
  it('has the 10 Appendix F rules, all unreviewed', () => {
    expect(RADAR_RULES.map((r) => r.id).sort()).toEqual(
      ['RAD-ADM-DS-01', 'RAD-CHEMO-PRIOR-01', 'RAD-HPE-IHC-01', 'RAD-IMG-PT-01', 'RAD-MOL-01', 'RAD-PEND-01', 'RAD-REF-01', 'RAD-RT-SUM-01', 'RAD-RX-OUT-01', 'RAD-SURG-HPE-01'].sort(),
    )
    expect(RADAR_RULES.every((r) => r.clinician_reviewed === false && r.version === 1)).toBe(true)
  })
  it('wording templates pass the radar and legal copy lint (EN + HI) and use known placeholders', () => {
    for (const r of RADAR_RULES) {
      for (const l of ['en', 'hi'] as const) {
        expect(lintText(r.wording[l], ['radar', 'legal'])).toEqual([])
        for (const [, k] of r.wording[l].matchAll(/\{(\w+)\}/g)) expect(['event_date', 'source_label', 'test', 'scan', 'institution', 'missing_list']).toContain(k)
      }
      expect(r.wording.en).toMatch(/not in file/)
    }
  })
  it('loader validates', () => {
    const one = RULES_YAML.split('\n- id: ')[0] + '\n- id: ' + RULES_YAML.split('\n- id: ')[1]
    expect(loadRules(one)).toHaveLength(1)
    expect(() => loadRules(one.replace('pathology_report', 'path_report'))).toThrow()
    expect(() => loadRules(one.replace('window_days: [0, 60]', 'window_days: [60, 0]'))).toThrow()
    expect(() => loadRules(one.replace('clinician_reviewed: false', 'clinician_reviewed: false\n  care_gap: true'))).toThrow()
    expect(() => loadRules(one + '\n' + one.split('\n').filter((l) => !l.startsWith('#')).join('\n'))).toThrow(/duplicate/)
    expect(() => loadRules('[]')).toThrow()
  })
})

describe('RAD-SURG-HPE-01', () => {
  it('missing histopathology → one administrative item (FR-RAD-04 wording)', () => {
    const { items, closureProposals } = run({ events: [WLE], documents: [DS] })
    expect(closureProposals).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      ruleId: 'RAD-SURG-HPE-01',
      ruleVersion: 1,
      triggerEventId: 'e-wle',
      triggerKind: 'event',
      expectedTypes: ['pathology_report'],
      window: { from: '2026-03-12', to: '2026-05-11' },
      sourceLabel: 'Discharge summary, p.2',
      mode: 'shadow',
      dedupeKey: dedupeKeyFor('RAD-SURG-HPE-01', 'e-wle'),
    })
    expect(items[0].wording.en).toBe('Histopathology report not in file for the procedure documented on 12 Mar 2026 (Discharge summary, p.2).')
    expect(items[0].wording.hi).toBe('12 मार्च 2026 को दर्ज प्रक्रिया की हिस्टोपैथोलॉजी रिपोर्ट फ़ाइल में नहीं है (डिस्चार्ज सारांश, पृ.2)।')
    expect(items[0].neutralWording.en).toBe('Laboratory report (tissue) not in file for an item documented on 12 Mar 2026.')
  })
  it('dedupe key = sha256(ruleId:trigger)[:32]', () => {
    expect(dedupeKeyFor('RAD-SURG-HPE-01', 'e-wle')).toBe(createHash('sha256').update('RAD-SURG-HPE-01:e-wle').digest('hex').slice(0, 32))
  })
  it('matching report in window, same institution → closure proposal, no item', () => {
    const r = run({ events: [WLE], documents: [DS, doc('d-hpe', 'pathology_report', '2026-03-20')] })
    expect(r.items).toEqual([])
    expect(r.closureProposals).toEqual([{ dedupeKey: dedupeKeyFor('RAD-SURG-HPE-01', 'e-wle'), documentId: 'd-hpe' }])
  })
  it('E-RAD-01 report from another institution → proposed with "institution differs" note', () => {
    const r = run({ events: [WLE], documents: [DS, doc('d-hpe', 'pathology_report', '2026-03-20', 'Metro Labs')] })
    expect(r.closureProposals).toEqual([{ dedupeKey: dedupeKeyFor('RAD-SURG-HPE-01', 'e-wle'), documentId: 'd-hpe', note: 'institution_differs' }])
  })
  it('prefers the same-institution report when both exist', () => {
    const r = run({ events: [WLE], documents: [DS, doc('a-other', 'pathology_report', '2026-03-14', 'Metro Labs'), doc('z-same', 'pathology_report', '2026-04-20', 'CITY CANCER HOSPITAL, Pune')] })
    expect(r.closureProposals[0]).toEqual({ dedupeKey: dedupeKeyFor('RAD-SURG-HPE-01', 'e-wle'), documentId: 'z-same' })
  })
  it('report outside the window does not count', () => {
    for (const date of ['2026-03-11', '2026-05-12', '2025-01-01']) expect(run({ events: [WLE], documents: [DS, doc('d-hpe', 'pathology_report', date)] }).items).toHaveLength(1)
    expect(run({ events: [WLE], documents: [DS, doc('d-hpe', 'pathology_report', '2026-05-11')] }).items).toHaveLength(0)
  })
  it('undated report → proposed with note', () => {
    expect(run({ events: [WLE], documents: [DS, doc('d-hpe', 'pathology_report', null)] }).closureProposals[0].note).toBe('document_date_unknown')
  })
  it('wrong document type does not count', () => {
    expect(run({ events: [WLE], documents: [DS, doc('d-x', 'imaging_report', '2026-03-20')] }).items).toHaveLength(1)
  })
  it('only excision/resection/-ectomy/biopsy keywords trigger', () => {
    const port = ev('procedure_documented', { procedure_text: 'chemoport insertion' }, '2026-03-12', 'd-ds')
    const ectomy = ev('procedure_documented', { procedure_text: 'Total thyroidectomy' }, '2026-03-12', 'd-ds')
    expect(run({ events: [port], documents: [DS] }).items).toEqual([])
    expect(run({ events: [ectomy], documents: [DS] }).items).toHaveLength(1)
  })
  it('undated trigger falls back to the document date; no date at all → no item', () => {
    const e1 = ev('procedure_documented', { procedure_text: 'biopsy' }, null, 'd-ds', { documentDate: '2026-03-16' })
    expect(run({ events: [e1], documents: [DS] }).items[0].window.from).toBe('2026-03-16')
    const e2 = ev('procedure_documented', { procedure_text: 'biopsy' }, null, 'd-ds')
    expect(run({ events: [e2], documents: [DS] }).items).toEqual([])
  })
  it('month-precision trigger widens the window to the whole month', () => {
    const e = ev('procedure_documented', { procedure_text: 'mastectomy' }, '2026-03-01', 'd-ds', { datePrecision: 'month' })
    const r = run({ events: [e], documents: [DS] })
    expect(r.items[0].window).toEqual({ from: '2026-03-01', to: '2026-05-30' })
    expect(r.items[0].wording.en).toContain('documented on Mar 2026')
  })
  it('ignores rejected, superseded, detached-document and future-dated triggers', () => {
    const rejected = ev('procedure_documented', { procedure_text: 'biopsy' }, '2026-03-12', 'd-ds', { verificationStatus: 'rejected' })
    const old = ev('procedure_documented', { procedure_text: 'biopsy' }, '2026-03-12', 'd-ds', { id: 'old' })
    const fixed = ev('procedure_documented', { procedure_text: 'excision' }, '2026-03-13', 'd-ds', { id: 'new', supersedesId: 'old' })
    const detached = ev('procedure_documented', { procedure_text: 'biopsy' }, '2026-03-12', 'd-gone')
    const future = ev('procedure_documented', { procedure_text: 'biopsy' }, '2027-03-12', 'd-ds')
    const r = run({ events: [rejected, old, fixed, detached, future], documents: [DS, doc('d-gone', 'discharge_summary', '2026-03-16', null, { detachedAt: '2026-10-01T00:00:00Z' })] })
    expect(r.items.map((i) => i.triggerEventId)).toEqual(['new'])
  })
})

describe('RAD-HPE-IHC-01 / RAD-PEND-01 / RAD-MOL-01', () => {
  const HPE = doc('d-hpe', 'pathology_report', '2026-03-20', 'Metro Labs')
  it('E-DOC-17 "IHC to follow" → IHC item only (no duplicate PEND item)', () => {
    const e = ev('report_pending_documented', { test_name: 'ER/PR/HER2', status_text: 'to follow' }, null, 'd-hpe', { documentDate: '2026-03-20' })
    const r = run({ events: [e], documents: [HPE] })
    expect(r.items.map((i) => i.ruleId)).toEqual(['RAD-HPE-IHC-01'])
    expect(r.items[0].wording.en).toBe('IHC report mentioned as pending on 20 Mar 2026 is not in file (Histopathology report, p.2).')
    expect(run({ events: [e], documents: [HPE, doc('d-ihc', 'ihc_molecular_report', '2026-04-02', 'Metro Labs')] }).items).toEqual([])
  })
  it.each([
    ['PET-CT report', 'imaging_report'],
    ['HPE report', 'pathology_report'],
    ['EGFR', 'ihc_molecular_report'],
    ['CA-125', 'lab_report'],
  ] as const)('named pending test %s → expects %s', (test, type) => {
    const e = ev('report_pending_documented', { test_name: test, status_text: 'awaited' }, '2026-03-16', 'd-ds')
    const r = run({ events: [e], documents: [DS] })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ ruleId: 'RAD-PEND-01', expectedTypes: [type] })
    expect(r.items[0].wording.en).toBe(`${test} report mentioned as pending on 16 Mar 2026 is not in file (Discharge summary, p.2).`)
  })
  it('molecular test documented as sent', () => {
    const e = ev('molecular_test_documented', { test_name: 'EGFR mutation analysis', status_text: 'sent' }, '2026-04-03', 'd-ihc')
    const r = run({ events: [e], documents: [doc('d-ihc', 'pathology_report', '2026-04-02')] })
    expect(r.items.map((i) => [i.ruleId, i.wording.en])).toEqual([
      ['RAD-MOL-01', 'EGFR mutation analysis report for the sample documented as sent on 3 Apr 2026 is not in file (Histopathology report, p.2).'],
    ])
    const notSent = ev('molecular_test_documented', { test_name: 'EGFR', status_text: 'reported' }, '2026-04-03', 'd-ihc')
    expect(run({ events: [notSent], documents: [doc('d-ihc', 'pathology_report', '2026-04-02')] }).items).toEqual([])
  })
})

describe('RAD-ADM-DS-01 / RAD-RT-SUM-01 / RAD-REF-01', () => {
  it('admission documented inside a discharge summary is satisfied by that document', () => {
    const e = ev('admission_documented', {}, '2026-03-10', 'd-ds')
    const r = run({ events: [e], documents: [DS] })
    expect(r.items).toEqual([])
    expect(r.closureProposals).toEqual([{ dedupeKey: dedupeKeyFor('RAD-ADM-DS-01', e.id), documentId: 'd-ds' }])
  })
  it('admission mentioned in a consult note without a discharge summary → item', () => {
    const e = ev('admission_documented', {}, '2026-03-10', 'd-op')
    const r = run({ events: [e], documents: [doc('d-op', 'consult_note', '2026-04-01')] })
    expect(r.items[0].wording.en).toBe('Discharge summary not in file for the admission documented on 10 Mar 2026 (Consultation note, p.2).')
  })
  it('radiotherapy completed', () => {
    const e = ev('radiotherapy_documented', { treatment_text: 'Radiotherapy', status_text: 'completed' }, '2026-05-15', 'd-op')
    const r = run({ events: [e], documents: [doc('d-op', 'consult_note', '2026-06-01')] })
    expect(r.items.map((i) => i.ruleId)).toEqual(['RAD-RT-SUM-01'])
    const started = ev('radiotherapy_documented', { treatment_text: 'Radiotherapy', status_text: 'started' }, '2026-05-15', 'd-op')
    expect(run({ events: [started], documents: [doc('d-op', 'consult_note', '2026-06-01')] }).items).toEqual([])
  })
  it('referral', () => {
    const e = ev('referral_documented', { referred_to_text: 'Dr. Rao, Radiation Oncology' }, '2026-03-16', 'd-ds')
    const r = run({ events: [e], documents: [DS] })
    expect(r.items[0].wording.en).toBe('Note from the referral to Dr. Rao, Radiation Oncology documented on 16 Mar 2026 is not in file (Discharge summary, p.2).')
    expect(run({ events: [e], documents: [DS, doc('d-c', 'consult_note', '2026-04-01', 'Regional Cancer Centre')] }).items).toEqual([])
  })
})

describe('RAD-CHEMO-PRIOR-01 (E-RAD-04 grouping)', () => {
  const DC = (id: string, date: string) => doc(id, 'chemo_daycare_record', date)
  const cyc = (n: number, docId: string, date: string) => ev('chemotherapy_session_documented', { cycle_number: String(n) }, date, docId, { id: `c${n}` })
  it('cycle 4 alone → ONE grouped item for cycles 1–3', () => {
    const r = run({ events: [cyc(4, 'dc4', '2026-04-10')], documents: [DC('dc4', '2026-04-10')] })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ ruleId: 'RAD-CHEMO-PRIOR-01', grouped: { cycles: [1, 2, 3] }, triggerEventId: 'c4', window: { from: null, to: '2026-04-10' } })
    expect(r.items[0].wording.en).toBe('Chemotherapy records for cycles 1–3 are not in file (Day-care record, p.2).'.replace('Day-care record', 'Chemotherapy day-care record'))
    expect(r.items[0].neutralWording.en).toBe('Day-care records for 3 earlier visits not in file.')
  })
  it('gaps are listed compactly and the key is stable as records arrive', () => {
    const a = run({ events: [cyc(6, 'dc6', '2026-05-01'), cyc(2, 'dc2', '2026-02-01'), cyc(3, 'dc3', '2026-02-20')], documents: [DC('dc6', '2026-05-01'), DC('dc2', '2026-02-01'), DC('dc3', '2026-02-20')] })
    expect(a.items[0].grouped).toEqual({ cycles: [1, 4, 5] })
    expect(a.items[0].wording.en).toContain('cycles 1, 4–5')
    const b = run({ events: [cyc(4, 'dc4', '2026-04-10')], documents: [DC('dc4', '2026-04-10')] })
    expect(a.items[0].dedupeKey).toBe(b.items[0].dedupeKey)
  })
  it('cycle mentions outside day-care records do not count as records', () => {
    const r = run({ events: [cyc(3, 'dc3', '2026-03-01'), cyc(1, 'd-ds', '2026-01-01'), cyc(2, 'd-ds', '2026-02-01')], documents: [DC('dc3', '2026-03-01'), DS] })
    expect(r.items[0].grouped).toEqual({ cycles: [1, 2] })
  })
  it('all earlier cycles present → closure proposal', () => {
    const r = run({ events: [cyc(1, 'dc1', '2026-01-01'), cyc(2, 'dc2', '2026-02-01')], documents: [DC('dc1', '2026-01-01'), DC('dc2', '2026-02-01')] })
    expect(r.items).toEqual([])
    expect(r.closureProposals).toEqual([{ dedupeKey: dedupeKeyFor('RAD-CHEMO-PRIOR-01', 'patient'), documentId: 'dc1' }])
  })
  it('cycle 1 only → nothing', () => {
    expect(run({ events: [cyc(1, 'dc1', '2026-01-01')], documents: [DC('dc1', '2026-01-01')] })).toEqual({ items: [], closureProposals: [] })
  })
  it('formatCycleList', () => {
    expect(formatCycleList([3, 1, 2, 5, 7, 8])).toBe('1–3, 5, 7–8')
    expect(formatCycleList([2])).toBe('2')
  })
})

describe('patient-statement rules', () => {
  it('RAD-IMG-PT-01: scan the patient mentioned', () => {
    const s = stmt('s1', { scanNames: ['PET-CT'], statedDate: '2026-10-05' })
    const r = run({ statements: [s] })
    expect(r.items[0]).toMatchObject({ ruleId: 'RAD-IMG-PT-01', triggerKind: 'statement', sourceLabel: 'patient statement', window: { from: '2026-09-05', to: '2026-11-04' } })
    expect(r.items[0].wording.en).toBe('Report for the PET-CT the patient mentioned is not in file (patient statement).')
    expect(run({ statements: [s], documents: [doc('d-pet', 'imaging_report', '2026-10-04', 'Other Hospital')] }).items).toEqual([])
  })
  it('RAD-RX-OUT-01: prescription the patient mentioned (institution fallback)', () => {
    const r = run({ statements: [stmt('s2', { questionId: 'new_medicines', medicationNames: ['Letrozole'] })] })
    expect(r.items[0].wording.en).toBe('Prescription the patient mentioned from another hospital is not in file (patient statement).')
    const r2 = run({ statements: [stmt('s3', { medicationNames: ['Letrozole'], institutionName: 'Sunrise Clinic' })] })
    expect(r2.items[0].wording.en).toContain('from Sunrise Clinic')
  })
})

describe('modes (FR-RAD-05, E-RAD-03)', () => {
  const reviewed = RADAR_RULES.map((r) => ({ ...r, clinician_reviewed: r.id === 'RAD-SURG-HPE-01' }))
  it('only clinician-reviewed rules can run in production', () => {
    const r = run({ events: [WLE, ev('admission_documented', {}, '2026-01-10', 'd-op')], documents: [DS, doc('d-op', 'consult_note', '2026-04-01')], rules: reviewed })
    expect(r.items.map((i) => [i.ruleId, i.mode])).toEqual([
      ['RAD-ADM-DS-01', 'shadow'],
      ['RAD-SURG-HPE-01', 'production'],
    ])
  })
  it('org review record (rule_states) sets the mode; absent → YAML default', () => {
    const r = run({ events: [WLE], documents: [DS], rules: reviewed, ruleModes: { 'RAD-SURG-HPE-01': 'shadow' } })
    expect(r.items[0].mode).toBe('shadow')
    expect(run({ events: [WLE], documents: [DS], ruleModes: { 'RAD-SURG-HPE-01': 'production' } }).items[0].mode).toBe('production')
    expect(run({ events: [WLE], documents: [DS] }).items[0].mode).toBe('shadow')
  })
})

describe('generated wording passes copy lint', () => {
  it('staff wording: radar+legal; neutral wording: radar+diagnosis', () => {
    const r = run({
      events: [
        WLE,
        ev('report_pending_documented', { test_name: 'IHC', status_text: 'to follow' }, '2026-03-16', 'd-ds'),
        ev('chemotherapy_session_documented', { cycle_number: '3' }, '2026-04-10', 'd-ds'),
        ev('radiotherapy_documented', { status_text: 'completed' }, '2026-05-15', 'd-ds'),
        ev('admission_documented', {}, '2026-01-10', 'd-op'),
      ],
      documents: [DS, doc('d-op', 'consult_note', '2026-04-01')],
      statements: [stmt('s1', { scanNames: ['CT'] })],
    })
    expect(r.items.length).toBeGreaterThanOrEqual(6)
    for (const i of r.items) {
      for (const l of ['en', 'hi'] as const) {
        expect(lintText(i.wording[l], ['radar', 'legal'])).toEqual([])
        expect(lintText(i.neutralWording[l], ['radar', 'diagnosis'])).toEqual([])
      }
    }
  })
})

describe('properties: deterministic and order-independent (FR-RAD-02)', () => {
  const types: EventType[] = ['procedure_documented', 'report_pending_documented', 'admission_documented', 'chemotherapy_session_documented', 'radiotherapy_documented', 'referral_documented', 'molecular_test_documented']
  const docTypes: DocType[] = ['pathology_report', 'ihc_molecular_report', 'discharge_summary', 'chemo_daycare_record', 'radiotherapy_summary', 'consult_note', 'imaging_report', 'lab_report']
  const date = fc.integer({ min: 0, max: 700 }).map((d) => new Date(Date.UTC(2025, 0, 1) + d * 86_400_000).toISOString().slice(0, 10))
  const record = fc.record({
    docs: fc.uniqueArray(fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }), t: fc.constantFrom(...docTypes), date: fc.option(date), inst: fc.constantFrom('A Hospital', 'B Labs', null) }), { selector: (d) => d.id, maxLength: 8 }),
    events: fc.uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 4 }),
        t: fc.constantFrom(...types),
        date: fc.option(date),
        docIdx: fc.nat(),
        text: fc.constantFrom('biopsy', 'IHC', 'PET-CT', 'completed', 'sent', '3', '5', 'Dr Rao'),
      }),
      { selector: (e) => e.id, maxLength: 12 },
    ),
    stmts: fc.uniqueArray(fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }), scan: fc.boolean(), date: fc.option(date) }), { selector: (s) => s.id, maxLength: 3 }),
  })
  type Rec = typeof record extends fc.Arbitrary<infer T> ? T : never
  const build = (r: Rec) => {
    const documents = r.docs.map((d) => doc(`d${d.id}`, d.t, d.date, d.inst))
    const events = r.events.map((e) => {
      const d = documents.length ? documents[e.docIdx % documents.length] : null
      const fields: Record<string, FieldValue> = { procedure_text: e.text, test_name: e.text, status_text: e.text, cycle_number: e.text, referred_to_text: e.text }
      return ev(e.t, fields, e.date, d?.id ?? null, { id: `e${e.id}` })
    })
    const statements = r.stmts.map((s) => stmt(`s${s.id}`, s.scan ? { scanNames: ['CT'], statedDate: s.date } : { medicationNames: ['X'], statedDate: s.date }))
    return { events, documents, statements }
  }

  it('same input → same output; shuffled input → same output', () => {
    fc.assert(
      fc.property(record, fc.nat(), (r, seed) => {
        const input = build(r)
        const a = run(input)
        expect(run(build(r))).toEqual(a)
        const shuffle = <T,>(xs: T[]) => xs.map((x, i) => [x, (i * 7919 + seed) % 101] as const).sort((p, q) => p[1] - q[1]).map((p) => p[0])
        expect(run({ events: shuffle(input.events), documents: shuffle(input.documents), statements: shuffle(input.statements) })).toEqual(a)
        // every item's key is unique
        expect(new Set(a.items.map((i) => i.dedupeKey)).size).toBe(a.items.length)
      }),
      { numRuns: 300 },
    )
  })
})

describe('transitionMissing (FR-RAD-03)', () => {
  it.each([
    ['expected', { type: 'request' }, 'requested'],
    ['expected', { type: 'receive', documentId: 'd' }, 'received'],
    ['requested', { type: 'receive', documentId: 'd' }, 'received'],
    ['received', { type: 'confirm' }, 'closed'],
    ['received', { type: 'reject_match', backTo: 'requested' }, 'requested'],
    ['received', { type: 'reject_match', backTo: 'expected' }, 'expected'],
    ['expected', { type: 'unobtainable', reason: 'patient reports lost' }, 'unobtainable'],
    ['requested', { type: 'unobtainable', reason: 'institution closed' }, 'unobtainable'],
    ['requested', { type: 'dismiss', reason: 'duplicate' }, 'dismissed'],
    ['dismissed', { type: 'reopen' }, 'expected'],
    ['unobtainable', { type: 'reopen' }, 'expected'],
    ['unobtainable', { type: 'receive', documentId: 'd' }, 'received'],
  ] as const)('%s + %o → %s', (from, action, to) => {
    expect(transitionMissing(from, action)).toEqual({ ok: true, state: to })
  })
  it.each([
    ['expected', { type: 'confirm' }],
    ['requested', { type: 'request' }],
    ['closed', { type: 'reopen' }],
    ['closed', { type: 'receive', documentId: 'd' }],
    ['dismissed', { type: 'request' }],
    ['received', { type: 'request' }],
  ] as const)('%s + %o → invalid', (from, action) => {
    expect(transitionMissing(from, action)).toEqual({ ok: false, error: 'invalid_transition' })
  })
  it('dismiss / unobtainable require a reason (E-RAD-02)', () => {
    expect(transitionMissing('expected', { type: 'dismiss', reason: '  ' })).toEqual({ ok: false, error: 'reason_required' })
    expect(transitionMissing('expected', { type: 'unobtainable', reason: '' })).toEqual({ ok: false, error: 'reason_required' })
  })
})
