import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CoreDocument, CoreEvent, CoreStatement, DocType, EventType, FieldValue } from '../types'
import { buildSnapshot, bulkVerifyEligible, canonicalJson, diffLedger, hashSnapshot, requestState, type LedgerRecord, type MissingLike } from '.'

const ev = (id: string, eventType: EventType, fields: Record<string, FieldValue>, eventDate: string | null, documentId: string | null, extra: Partial<CoreEvent> = {}): CoreEvent => ({
  id,
  eventType,
  fields,
  eventDate,
  datePrecision: eventDate ? 'day' : 'unknown',
  documentDate: null,
  receivedAt: '2026-03-20T10:00:00Z',
  documentId,
  sourceType: 'external_document',
  extractionMethod: 'text_layer',
  verificationStatus: 'unverified',
  flags: [],
  version: 1,
  evidence: [{ documentId, pageNo: 1, charStart: 0, charEnd: 12, quote: 'secret quote', quoteSha256: `h-${id}` }],
  ...extra,
})
const doc = (id: string, docType: DocType, documentDate: string | null, extra: Partial<CoreDocument> = {}): CoreDocument => ({ id, docType, documentDate, receivedAt: '2026-03-20T10:00:00Z', institution: 'City Cancer Hospital', ...extra })
const stmt = (id: string, capturedAt: string, extra: Partial<CoreStatement> = {}): CoreStatement => ({ id, questionId: 'new_medicines', transcript: 'new tablets', language: 'en', confirmation: 'patient_confirmed', capturedAt, ...extra })
const missing = (key: string, extra: Partial<MissingLike> = {}): MissingLike => ({ dedupeKey: key, ruleId: 'RAD-SURG-HPE-01', ruleVersion: 1, triggerEventId: 'e1', expectedTypes: ['pathology_report'], wording: { en: 'x not in file', hi: 'x' }, ...extra })

describe('canonicalJson', () => {
  it('sorted keys, no whitespace, stable numbers', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: true, c: null }], e: 'x' })).toBe('{"a":[3,{"c":null,"d":true}],"b":1,"e":"x"}')
    expect(canonicalJson([1.0, 0.1, 1e21, -0, 1.5e-7])).toBe('[1,0.1,1e+21,0,1.5e-7]')
    expect(canonicalJson({ u: undefined, k: 'é\n"' })).toBe('{"k":"é\\n\\""}')
    expect(canonicalJson([undefined])).toBe('[null]')
    expect(canonicalJson({ d: new Date('2026-03-12T00:00:00Z') })).toBe('{"d":"2026-03-12T00:00:00.000Z"}')
    expect(canonicalJson({ Z: 1, a: 2, _: 3 })).toBe('{"Z":1,"_":3,"a":2}')
  })
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ x: NaN })).toThrow()
    expect(() => canonicalJson(Infinity)).toThrow()
  })
  it('property: round-trips JSON values and ignores key order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const c = canonicalJson(v)
        expect(JSON.parse(c)).toEqual(JSON.parse(JSON.stringify(v)))
        const reversed = JSON.parse(JSON.stringify(v), (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse()) : x))
        expect(canonicalJson(reversed)).toBe(c)
        expect(canonicalJson(JSON.parse(c))).toBe(c) // idempotent
        expect(c).toBe(c.trim())
      }),
      { numRuns: 300 },
    )
  })
})

const base = (): LedgerRecord => ({
  patientId: 'p1',
  documents: [doc('d-ds', 'discharge_summary', '2026-03-16'), doc('d-hpe', 'pathology_report', '2026-03-20')],
  events: [
    ev('e-adm', 'admission_documented', {}, '2026-03-10', 'd-ds', { verificationStatus: 'verified_matches_source' }),
    ev('e-wle', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-12', 'd-ds', { verificationStatus: 'edited' }),
    ev('e-path', 'pathology_report_documented', { test_name: 'Histopathology report' }, '2026-03-20', 'd-hpe'),
    ev('e-rej', 'referral_documented', { referred_to_text: 'X' }, '2026-03-12', 'd-ds', { verificationStatus: 'rejected' }),
    ev('e-disp', 'discharge_documented', {}, '2026-03-16', 'd-ds', { verificationStatus: 'disputed' }),
  ],
  statements: [stmt('s1', '2026-03-18T05:00:00Z', { medicationNames: ['Letrozole'] })],
  missing: [missing('k1'), missing('k-shadow', { mode: 'shadow' }), missing('k-closed', { state: 'closed' })],
})
const SEAL = '2026-03-21T09:00:00Z'

describe('buildSnapshot / hashSnapshot', () => {
  it('separates verified and unverified items, labels them, and keeps only hashes of quotes', () => {
    const s = buildSnapshot(base(), SEAL)
    expect(s.schema).toBe('snapshot.v1')
    expect(s.verified.map((e) => [e.id, e.label])).toEqual([
      ['e-adm', 'Verified'],
      ['e-wle', 'Verified'],
    ])
    expect(s.unverified.map((e) => [e.id, e.label])).toEqual([
      ['e-disp', 'Disputed'],
      ['e-path', 'Not yet verified'],
    ])
    expect(JSON.stringify(s)).not.toContain('secret quote')
    expect(s.verified[0].evidence[0].quoteSha256).toBe('h-e-adm')
    expect(s.documents.map((d) => d.id)).toEqual(['d-ds', 'd-hpe'])
    expect(s.missing.map((m) => m.dedupeKey)).toEqual(['k1'])
    expect(s.statements.map((x) => x.id)).toEqual(['s1'])
  })
  it('excludes superseded versions and detached documents', () => {
    const r = base()
    r.events.push(ev('e-wle2', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-13', 'd-ds', { supersedesId: 'e-wle', version: 2 }))
    r.documents.push(doc('d-wrong', 'lab_report', '2026-03-01', { detachedAt: '2026-03-20T00:00:00Z' }))
    r.events.push(ev('e-wrong', 'lab_report_documented', {}, '2026-03-01', 'd-wrong'))
    const s = buildSnapshot(r, SEAL)
    const ids = [...s.verified, ...s.unverified].map((e) => e.id)
    expect(ids).toContain('e-wle2')
    expect(ids).not.toContain('e-wle')
    expect(ids).not.toContain('e-wrong')
    expect(s.documents.map((d) => d.id)).not.toContain('d-wrong')
  })
  it('hash is stable across input order and changes on any change (tamper test)', () => {
    const r = base()
    const h = hashSnapshot(buildSnapshot(r, SEAL))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSnapshot(buildSnapshot({ ...r, events: [...r.events].reverse(), documents: [...r.documents].reverse() }, SEAL))).toBe(h)
    const s = buildSnapshot(r, SEAL)
    s.verified[0].fields = { ...s.verified[0].fields, x: '1' }
    expect(hashSnapshot(s)).not.toBe(h)
    expect(hashSnapshot(buildSnapshot(r, '2026-03-21T09:00:01Z'))).not.toBe(h)
  })
})

describe('diffLedger: initial record (FR-LED-06)', () => {
  it('no snapshot → initial mode, FR-ONB-01 document priority then date', () => {
    const r = base()
    r.documents.push(doc('d-lab', 'lab_report', '2026-03-01'))
    r.events.push(ev('e-lab', 'lab_report_documented', {}, '2026-03-01', 'd-lab'))
    const l = diffLedger(null, r, '2026-03-21T00:00:00Z')
    expect(l.mode).toBe('initial')
    expect(l.sealedAt).toBeNull()
    expect(l.initial_record.map((i) => i.event.id)).toEqual(['e-path', 'e-adm', 'e-wle', 'e-disp', 'e-lab'])
    expect(l.patient_said.map((s) => s.id)).toEqual(['s1'])
    expect(l.missing.map((m) => m.dedupeKey)).toEqual(['k1'])
    expect(l.new_since_last_visit).toEqual([])
  })
})

describe('diffLedger: returning visit (FR-LED-02)', () => {
  const prev = buildSnapshot(base(), SEAL)
  const next = (): LedgerRecord => {
    const r = base()
    r.documents.push(doc('d-ct', 'imaging_report', '2026-04-05'), doc('d-old', 'imaging_report', '2024-01-10', { receivedAt: '2026-04-01T00:00:00Z' }))
    r.events.push(
      ev('e-ct', 'imaging_report_documented', { test_name: 'CECT thorax' }, '2026-04-05', 'd-ct'),
      ev('e-old', 'imaging_report_documented', { test_name: 'USG abdomen' }, '2024-01-10', 'd-old'),
      ev('e-undated', 'consultation_documented', {}, null, 'd-ct'),
      ev('e-sameday', 'lab_report_documented', {}, '2026-03-21', 'd-ct'),
    )
    r.statements.push(stmt('s2', '2026-04-04T05:00:00Z'))
    return r
  }

  it('new since last visit vs newly received older (late_received)', () => {
    const l = diffLedger(prev, next(), '2026-04-06T00:00:00Z')
    expect(l.mode).toBe('diff')
    expect(l.new_since_last_visit.map((i) => i.event.id)).toEqual(['e-ct'])
    expect(l.newly_received_older.map((i) => [i.event.id, i.flags])).toEqual([
      ['e-old', ['late_received']],
      ['e-sameday', ['late_received']],
      ['e-undated', ['late_received']],
    ])
    expect(l.patient_said.map((s) => s.id)).toEqual(['s2'])
    // items already in the snapshot are not repeated
    expect([...l.new_since_last_visit, ...l.newly_received_older].map((i) => i.event.id)).not.toContain('e-wle')
  })

  it('amended: new version of a sealed event, or event from an amendment document (E-DOC-03, E-LED-05)', () => {
    const r = next()
    r.events.push(ev('e-wle2', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-12', 'd-ds', { supersedesId: 'e-wle', version: 2 }))
    r.documents.push(doc('d-hpe2', 'pathology_report', '2026-04-02', { amendmentOf: 'd-hpe' }))
    r.events.push(ev('e-add', 'pathology_report_documented', { test_name: 'Addendum' }, '2026-04-02', 'd-hpe2'))
    const l = diffLedger(prev, r, '2026-04-06T00:00:00Z')
    expect(l.amended.map((i) => [i.event.id, i.previousId])).toEqual([
      ['e-wle2', 'e-wle'],
      ['e-add', undefined],
    ])
  })

  it('E-LED-04: two documents give different surgery dates → conflict (both shown)', () => {
    const r = next()
    r.documents.push(doc('d-op', 'procedure_note', '2026-03-14'))
    r.events.push(ev('e-wle-op', 'procedure_documented', { procedure_text: 'Wide  local excision' }, '2026-03-14', 'd-op'))
    const l = diffLedger(prev, r, '2026-04-06T00:00:00Z')
    expect(l.conflicts).toEqual([
      { kind: 'procedure_date', eventType: 'procedure_documented', field: 'event_date', a: { kind: 'event', id: 'e-wle', value: '2026-03-12' }, b: { kind: 'event', id: 'e-wle-op', value: '2026-03-14' } },
    ])
    expect(l.newly_received_older.find((i) => i.event.id === 'e-wle-op')!.flags).toContain('conflict')
  })

  it('procedures more than 30 days apart are separate events, not a conflict', () => {
    const r = next()
    r.events.push(ev('e-wle-late', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-05-20', 'd-ct'))
    expect(diffLedger(prev, r, '2026-06-01T00:00:00Z').conflicts).toEqual([])
  })

  it('E-LED-03: patient statement vs latest prescription → conflict; E-LED-02 no prescription → patient said only', () => {
    const r = next()
    r.statements.push(stmt('s3', '2026-04-20T05:00:00Z', { medicationNames: ['Tamoxifen'] }))
    expect(diffLedger(prev, r, '2026-04-21T00:00:00Z').conflicts).toEqual([])
    r.documents.push(doc('d-rx', 'prescription_printed', '2026-04-15'))
    r.events.push(ev('e-rx', 'prescription_documented', { medication_names: ['Letrozole', 'Pan-D'] }, '2026-04-15', 'd-rx'))
    const l = diffLedger(prev, r, '2026-04-21T00:00:00Z')
    expect(l.conflicts).toEqual([
      { kind: 'medication_names', eventType: 'prescription_documented', field: 'medication_names', a: { kind: 'statement', id: 's3', value: 'Tamoxifen' }, b: { kind: 'event', id: 'e-rx', value: 'Letrozole, Pan-D' } },
    ])
    r.statements.push(stmt('s4', '2026-04-20T06:00:00Z', { medicationNames: ['letrozole'] }))
    expect(diffLedger(prev, r, '2026-04-21T00:00:00Z').conflicts.map((c) => c.a.id)).toEqual(['s3'])
  })

  it('same cycle number on two dates → conflict', () => {
    const r = next()
    r.events.push(ev('c4a', 'chemotherapy_session_documented', { cycle_number: '4' }, '2026-04-01', 'd-ct'), ev('c4b', 'chemotherapy_session_documented', { cycle_number: '4' }, '2026-04-08', 'd-ct'))
    expect(diffLedger(prev, r, '2026-04-10T00:00:00Z').conflicts.map((c) => [c.kind, c.a.id, c.b.id])).toEqual([['cycle_date', 'c4a', 'c4b']])
  })

  it('conflicts entirely inside the sealed snapshot are not repeated', () => {
    const r = base()
    r.events.push(ev('e-wle-op', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-14', 'd-ds'))
    const sealed = buildSnapshot(r, SEAL)
    expect(diffLedger(null, r, SEAL).conflicts).toHaveLength(1)
    expect(diffLedger(sealed, r, '2026-04-01T00:00:00Z').conflicts).toEqual([])
  })

  it('duplicates are suppressed with count and ids (E-DOC-01/02)', () => {
    const r = next()
    r.documents.push(doc('d-ct-copy', 'imaging_report', '2026-04-05', { duplicateOf: 'd-ct' }))
    r.events.push(ev('e-ct-copy', 'imaging_report_documented', { test_name: 'CECT thorax' }, '2026-04-05', 'd-ct-copy', { receivedAt: '2026-04-06T00:00:00Z' }))
    r.events.push(ev('e-ct-again', 'imaging_report_documented', { test_name: 'cect  THORAX', institution_name: 'Other' }, '2026-04-05', 'd-old', { receivedAt: '2026-04-07T00:00:00Z' }))
    const l = diffLedger(prev, r, '2026-04-08T00:00:00Z')
    expect(l.duplicates_suppressed).toEqual({ count: 2, ids: ['e-ct-again', 'e-ct-copy'] })
    expect(l.new_since_last_visit.map((i) => i.event.id)).toEqual(['e-ct'])
  })

  it('missing: open production items only', () => {
    expect(diffLedger(prev, next(), '2026-04-06T00:00:00Z').missing.map((m) => m.dedupeKey)).toEqual(['k1'])
  })

  it('E-LED-06 / FR-ID-06: document detached after seal → erratum, its events withdrawn', () => {
    const r = next()
    r.documents = r.documents.map((d) => (d.id === 'd-hpe' ? { ...d, detachedAt: '2026-04-01T00:00:00Z' } : d))
    const l = diffLedger(prev, r, '2026-04-06T00:00:00Z')
    expect(l.errata).toEqual([{ documentId: 'd-hpe', detachedAt: '2026-04-01T00:00:00Z', withdrawnEventIds: ['e-path'] }])
    expect(JSON.stringify(l)).not.toContain('"id":"e-path"')
  })

  it('property: deterministic and independent of input order', () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const r = next()
        r.events.push(ev('e-wle-op', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-14', 'd-ct'))
        const a = diffLedger(prev, r, '2026-04-06T00:00:00Z')
        const shuffle = <T,>(xs: T[]) => xs.map((x, i) => [x, (i * 7919 + seed) % 97] as const).sort((p, q) => p[1] - q[1]).map((p) => p[0])
        expect(diffLedger(prev, { ...r, events: shuffle(r.events), documents: shuffle(r.documents), statements: shuffle(r.statements), missing: shuffle(r.missing) }, '2026-04-06T00:00:00Z')).toEqual(a)
      }),
      { numRuns: 100 },
    )
  })
})

describe('bulkVerifyEligible (FR-LED-05)', () => {
  it.each([
    [{ flags: [] }, true, []],
    [{ flags: ['date_ambiguous'] }, true, []],
    [{ flags: ['conflict'] }, false, ['conflict']],
    [{ flags: ['low_confidence'] }, false, ['low_confidence']],
    [{ flags: [], spanConfidence: 0.79 }, false, ['low_confidence']],
    [{ flags: [], spanConfidence: 0.8 }, true, []],
    [{ flags: ['identity_warning'] }, false, ['identity_warning']],
    [{ flags: ['binding_uncertain'] }, false, ['binding_uncertain']],
    [{ flags: [], category: 'newly_received_older' }, false, ['newly_received_older']],
    [{ flags: ['late_received'] }, false, ['newly_received_older']],
    [{ flags: ['late_received'], category: 'initial_record' }, true, []],
    [{ flags: [], verificationStatus: 'disputed' }, false, ['disputed']],
    [{ flags: ['conflict', 'identity_warning'], category: 'newly_received_older' }, false, ['conflict', 'identity_warning', 'newly_received_older']],
  ] as const)('%o → %s', (item, eligible, reasons) => {
    expect(bulkVerifyEligible({ ...item, flags: [...item.flags] })).toEqual({ eligible, reasons })
  })
})

describe('requestState (FR-REQ-03)', () => {
  const sent = '2026-04-01T10:00:00Z'
  it.each([
    [null, '2026-04-01T10:00:00Z', undefined, undefined, 'drafted'],
    [sent, '2026-04-01T10:00:00Z', undefined, undefined, 'sent'],
    [sent, '2026-04-08T09:59:59Z', undefined, undefined, 'sent'],
    [sent, '2026-04-08T10:00:00Z', undefined, undefined, 'reminder_due'],
    [sent, '2026-04-22T09:00:00Z', undefined, undefined, 'reminder_due'],
    [sent, '2026-04-22T10:00:00Z', undefined, undefined, 'open_21d'],
    [sent, '2026-09-01T00:00:00Z', undefined, undefined, 'open_21d'],
    [sent, '2026-04-30T00:00:00Z', '2026-04-10T00:00:00Z', undefined, 'fulfilled'],
    [sent, '2026-04-30T00:00:00Z', undefined, 'unobtainable', 'unobtainable'],
    [null, '2026-04-30T00:00:00Z', undefined, 'withdrawn', 'withdrawn'],
  ] as const)('sent=%s now=%s → %s', (s, now, fulfilled, terminal, state) => {
    expect(requestState(s, now, fulfilled, terminal)).toBe(state)
  })
})

describe('same event written twice with different wording', () => {
  const rec = (events: CoreEvent[]): LedgerRecord => ({ patientId: 'p', events, documents: [doc('d1', 'discharge_summary', '2026-02-10'), doc('d2', 'chemo_daycare_record', '2026-02-10')], statements: [], missing: [] })
  const ids = (events: CoreEvent[]) => diffLedger(null, rec(events), '2026-03-01T00:00:00Z').initial_record.map((i) => i.event.id).sort()
  const dups = (events: CoreEvent[]) => diffLedger(null, rec(events), '2026-03-01T00:00:00Z').duplicates_suppressed.ids

  it('merges "Right hemicolectomy" and "hemicolectomy" on the same day, keeping the fuller one', () => {
    const a = ev('a', 'procedure_documented', { procedure_text: 'hemicolectomy' }, '2026-01-20', 'd1', { receivedAt: '2026-03-01T10:00:00Z' })
    const b = ev('b', 'procedure_documented', { procedure_text: 'Right hemicolectomy' }, '2026-01-20', 'd1', { receivedAt: '2026-03-02T10:00:00Z' })
    expect(ids([a, b])).toEqual(['b'])
    expect(dups([a, b])).toEqual(['a'])
  })
  it('merges the same cycle on the same day when one record also names the regimen', () => {
    const a = ev('a', 'chemotherapy_session_documented', { cycle_number: 1 }, '2026-02-10', 'd2')
    const b = ev('b', 'chemotherapy_session_documented', { cycle_number: 1, regimen_text: 'Capecitabine' }, '2026-02-10', 'd2', { receivedAt: '2026-03-02T10:00:00Z' })
    expect(ids([a, b])).toEqual(['b'])
  })
  it('never merges different dates, different cycles or unrelated procedures', () => {
    expect(ids([ev('a', 'procedure_documented', { procedure_text: 'hemicolectomy' }, '2026-01-20', 'd1'), ev('b', 'procedure_documented', { procedure_text: 'hemicolectomy' }, '2026-01-21', 'd1')])).toEqual(['a', 'b'])
    expect(ids([ev('a', 'chemotherapy_session_documented', { cycle_number: 1 }, '2026-02-10', 'd2'), ev('b', 'chemotherapy_session_documented', { cycle_number: 2 }, '2026-02-10', 'd2')])).toEqual(['a', 'b'])
    expect(ids([ev('a', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-01-20', 'd1'), ev('b', 'procedure_documented', { procedure_text: 'sentinel node biopsy' }, '2026-01-20', 'd1')])).toEqual(['a', 'b'])
  })
  it('merges the same cycle on the same day even when the regimen is worded differently', () => {
    expect(ids([ev('a', 'chemotherapy_session_documented', { cycle_number: 1, regimen_text: 'Capecitabine' }, '2026-02-10', 'd2'), ev('b', 'chemotherapy_session_documented', { cycle_number: 1, regimen_text: 'CAPOX regimen', event_date_text: '10/02/2026' }, '2026-02-10', 'd2')])).toHaveLength(1)
  })
  it('merges "CT" with "CT thorax" on the same day but not different scans', () => {
    const e = (id: string, name: string) => ev(id, 'imaging_report_documented', { test_name: name }, '2026-02-20', 'd1')
    expect(ids([e('a', 'CT'), e('b', 'CT thorax')])).toEqual(['b'])
    expect(ids([e('a', 'CT thorax'), e('b', 'PET-CT')])).toEqual(['a', 'b'])
  })
})
