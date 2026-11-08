import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSnapshot, canonicalJson, type Snapshot } from '@/core/ledger'
import {
  assembleRecord, buildLedgerView, buildTimeline, checkVerification, editedVersion, itemsById, permitsFor, resolvedKey,
  snapshotSummary, tierOf, type DocumentRow, type EventRow, type EvidenceRow, type RecordRows, type StatementRow,
} from './core'
import { checkSnapshot, sealBytes } from './seal'
import { bulkSkipReason } from './verify'

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('ed25519')
  process.env.SIGNING_KEY_ED25519 = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64')
  process.env.SIGNING_KEY_ID = 'k-test'
})

const NOW = '2026-11-02T06:00:00.000Z'
const P = '00000000-0000-7000-8000-000000000001'
let n = 0
const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`

const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: id(), orgId: 'o', patientId: P, encounterId: null, documentId: null, eventType: 'lab_report_documented',
  fields: { test_name: 'CBC' }, eventDate: '2026-10-01', datePrecision: 'day', dateFlags: [], documentDate: '2026-10-01',
  receivedAt: new Date('2026-10-02T05:00:00Z'), sourceType: 'external_document', extractionMethod: 'text_layer',
  verificationStatus: 'unverified', flags: {}, conflictGroup: null, withdrawnAt: null, withdrawnReason: null, version: 1,
  supersedesId: null, rowVersion: 0, createdByKind: 'system', createdById: null, createdAt: new Date(NOW), updatedAt: new Date(NOW),
  ...over,
})
const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: id(), docType: 'lab_report', documentDate: '2026-10-01', receivedAt: new Date('2026-10-02T05:00:00Z'), institutionName: 'City Hospital',
  sha256: 'f'.repeat(64), amendmentOf: null, duplicateOf: null, attachState: 'auto', attachDecidedAt: null, identityResult: 'match', status: 'done', ...over,
})
const quote = (e: EventRow, q = 'CBC done on 01/10/2026'): EvidenceRow => ({
  eventId: e.id, documentId: e.documentId, pageNo: 1, charStart: 0, charEnd: q.length, quote: q, quoteSha256: `h-${e.id}`, statementId: null,
})
const rows = (over: Partial<RecordRows>): RecordRows => ({ patientId: P, events: [], evidence: [], documents: [], statements: [], missing: [], verifications: [], ...over })
const sealed = (r: RecordRows, sealedAt: string) => {
  const snapshot = buildSnapshot(assembleRecord(r).record, sealedAt)
  return { snapshot, summary: snapshotSummary({ id: id(), seq: 0, sha256: 'a'.repeat(64), sealedAt: new Date(sealedAt), keyId: 'k-test' }, 'Dr A') }
}

describe('record loader mapping', () => {
  it('keeps attached, non-withdrawn events; drops pending documents, withdrawn events and statement events', () => {
    const ok = doc(), pending = doc({ attachState: 'pending_decision' }), quarantined = doc({ status: 'quarantined' }), detached = doc({ attachState: 'detached', attachDecidedAt: new Date('2026-10-20T00:00:00Z') })
    const e1 = event({ documentId: ok.id })
    const e2 = event({ documentId: pending.id })
    const e3 = event({ documentId: ok.id, withdrawnAt: new Date() })
    const e4 = event({ eventType: 'patient_statement', fields: { statement_text: 'x' } })
    const e5 = event({ documentId: detached.id })
    const e6 = event({ documentId: quarantined.id })
    const a = assembleRecord(rows({ events: [e1, e2, e3, e4, e5, e6], documents: [ok, pending, detached, quarantined], evidence: [quote(e1)] }))
    expect(a.record.events.map((e) => e.id).sort()).toEqual([e1.id, e5.id].sort())
    expect(a.record.documents.map((d) => d.id).sort()).toEqual([ok.id, detached.id].sort())
    expect(a.record.documents.find((d) => d.id === detached.id)!.detachedAt).toBe('2026-10-20T00:00:00.000Z')
    const ce = a.record.events.find((e) => e.id === e1.id)!
    expect(ce.evidence[0]).toMatchObject({ quote: 'CBC done on 01/10/2026', pageNo: 1, documentId: ok.id })
    expect(ce.receivedAt).toBe('2026-10-02T05:00:00.000Z')
  })

  it('maps flags (booleans + date flags), identity warnings, statements and missing rows', () => {
    const weak = doc({ identityResult: 'insufficient' })
    const e = event({ documentId: weak.id, flags: { low_confidence: true, ocr: true, conflict: false, 'edited:test_name': true }, dateFlags: ['date_ambiguous'] })
    const s: StatementRow = { id: id(), questionId: 'new_medicines', answer: { medicationNames: ['Tab X'], statedDate: '2026-10-05' }, transcript: 'I take Tab X', language: 'en', confirmation: 'confirmed', createdAt: new Date(NOW) }
    const a = assembleRecord(rows({
      events: [e], documents: [weak], statements: [s],
      missing: [
        { ruleId: 'RAD-X', ruleVersion: '2', mode: 'production', triggerEventId: e.id, expectedTypes: ['pathology_report', 'bogus'], state: 'expected', dedupeKey: 'k1', matchWindow: null },
        { ruleId: 'RAD-Y', ruleVersion: '1', mode: 'production', triggerEventId: e.id, expectedTypes: ['imaging_report'], state: 'requested', dedupeKey: 'k2', matchWindow: { wording: { en: 'Imaging report not in file for the scan documented on 2 Feb 2026', hi: 'h' } } },
      ],
    }))
    expect(a.record.events[0].flags).toEqual(['date_ambiguous', 'identity_warning', 'low_confidence'])
    expect(a.record.statements[0]).toMatchObject({ confirmation: 'patient_confirmed', medicationNames: ['Tab X'], statedDate: '2026-10-05', transcript: 'I take Tab X' })
    expect(a.record.missing[0]).toMatchObject({ ruleVersion: 2, expectedTypes: ['pathology_report'], wording: { en: 'Histopathology report not in file' } })
    expect(a.record.missing[1].wording.en).toBe('Imaging report not in file for the scan documented on 2 Feb 2026')
  })
})

describe('tier rules (FR-VER-02)', () => {
  it('assigns clinician tier to report/treatment events, conflicts and newly received older pathology/imaging', () => {
    expect(tierOf({ eventType: 'pathology_report_documented', flags: [] })).toBe('clinician')
    expect(tierOf({ eventType: 'chemotherapy_session_documented', flags: [] })).toBe('clinician')
    expect(tierOf({ eventType: 'lab_report_documented', flags: [] })).toBe('records')
    expect(tierOf({ eventType: 'prescription_documented', flags: ['conflict'] })).toBe('clinician')
    expect(tierOf({ eventType: 'document_received', flags: [], category: 'newly_received_older', docType: 'imaging_report' })).toBe('clinician')
    expect(tierOf({ eventType: 'document_received', flags: [], category: 'newly_received_older', docType: 'lab_report' })).toBe('records')
  })
  it('desk never verifies; records cannot act on clinician tier or dispute; reasons are required', () => {
    expect(checkVerification({ role: 'desk', tier: 'records', action: 'verify', eventType: 'lab_report_documented' })?.status).toBe(403)
    expect(checkVerification({ role: 'records', tier: 'clinician', action: 'verify', eventType: 'pathology_report_documented' })).toMatchObject({ status: 403, code: 'clinician_tier' })
    expect(checkVerification({ role: 'records', tier: 'records', action: 'dispute', eventType: 'lab_report_documented', reason: 'x' })?.status).toBe(403)
    expect(checkVerification({ role: 'records', tier: 'records', action: 'verify', eventType: 'lab_report_documented' })).toBeNull()
    expect(checkVerification({ role: 'clinician', tier: 'clinician', action: 'verify', eventType: 'pathology_report_documented' })).toBeNull()
    for (const action of ['edit', 'reject', 'dispute'] as const) {
      expect(checkVerification({ role: 'clinician', tier: 'records', action, eventType: 'lab_report_documented', reason: '  ', fields: { test_name: 'Y' } })?.code).toBe('reason_required')
    }
    expect(checkVerification({ role: 'clinician', tier: 'records', action: 'edit', eventType: 'lab_report_documented', reason: 'typo', fields: { stage: 'II' } })?.code).toBe('invalid_fields')
    expect(checkVerification({ role: 'clinician', tier: 'records', action: 'edit', eventType: 'lab_report_documented', reason: 'typo', fields: { test_name: '' } })?.code).toBe('invalid_fields')
    expect(checkVerification({ role: 'clinician', tier: 'records', action: 'edit', eventType: 'lab_report_documented', reason: 'typo', fields: { test_name: 'LFT' } })).toBeNull()
    expect(permitsFor('records', 'clinician').verify).toMatch(/clinician/i)
  })
})

describe('edit versioning (E-LED-05)', () => {
  it('an ambiguous date shows both readings until one is picked through the edit path (FR-EXT-03, V02-E2E-07)', () => {
    const old = event({ fields: { test_name: 'CBC', event_date_text: '05/06/2026' }, eventDate: '2026-06-05', dateFlags: ['date_ambiguous'], flags: { date_ambiguous: true } })
    const view = (e: EventRow) => itemsById(buildLedgerView({ rows: rows({ events: [e] }), prev: null, role: 'records', now: NOW })).get(e.id)!
    const before = view(old)
    expect(before.when.event).toBe('5 Jun 2026 or 6 May 2026')
    expect(before.when.readings).toEqual([{ iso: '2026-06-05', label: '5 Jun 2026' }, { iso: '2026-05-06', label: '6 May 2026' }])
    expect(buildTimeline(buildSnapshot(assembleRecord(rows({ events: [old] })).record, NOW), { quoteByHash: new Map() }).years[0].months[0].items[0].dateLabel).toBe('5 Jun 2026 or 6 May 2026')

    const next = editedVersion(old, { event_date_text: before.when.readings![1].label }, { staffId: 's1' }, new Date(NOW))
    expect(next).toMatchObject({ eventDate: '2026-05-06', datePrecision: 'day', dateFlags: [], verificationStatus: 'edited' })
    const after = view(event({ ...next, id: id() }))
    expect(after.flags).not.toContain('date_ambiguous')
    expect([after.when.event, after.when.readings]).toEqual(['6 May 2026', null])
  })


  it('builds a new version that supersedes the original, marks edited fields and re-parses the written date', () => {
    const old = event({ eventType: 'procedure_documented', fields: { procedure_text: 'wide local excison', event_date_text: '12/03/2026' }, eventDate: '2026-03-12', flags: { rule_based: true }, rowVersion: 3 })
    const next = editedVersion(old, { procedure_text: 'wide local excision ', event_date_text: '13 Mar 2026' }, { staffId: 's1' }, new Date(NOW))
    expect(next).toMatchObject({ version: 2, supersedesId: old.id, verificationStatus: 'edited', eventDate: '2026-03-13', rowVersion: 0, createdById: 's1', receivedAt: old.receivedAt })
    expect(next.fields).toEqual({ procedure_text: 'wide local excision', event_date_text: '13 Mar 2026' })
    expect(next.flags).toMatchObject({ rule_based: true, 'edited:procedure_text': true, 'edited:event_date_text': true })
    expect(old.fields.procedure_text).toBe('wide local excison') // original untouched
  })
  it('an edited patient statement stays what the patient said: never upgraded to document-supported (FR-VOX-05)', () => {
    for (const sourceType of ['patient_reported', 'caregiver_reported'] as const) {
      const old = event({ eventType: 'patient_statement', fields: { statement_text: 'Tab Letrozol 2.5' }, eventDate: null, datePrecision: 'unknown', documentDate: null, sourceType, extractionMethod: 'asr', flags: { patient_confirmed: true } })
      const next = editedVersion(old, { statement_text: 'Tab Letrozole 2.5' }, { staffId: 's1' }, new Date(NOW))
      expect(next).toMatchObject({ sourceType, extractionMethod: 'asr', documentId: null, documentDate: null, eventType: 'patient_statement' })
      expect(next.flags).toMatchObject({ patient_confirmed: true, 'edited:statement_text': true })
    }
  })
  it('an edit after a seal shows under Amended and replaces the original in the record', () => {
    const d = doc()
    const old = event({ documentId: d.id, eventDate: '2026-09-01' })
    const before = rows({ events: [old], documents: [d], evidence: [quote(old)] })
    const prev = sealed(before, '2026-10-15T06:00:00Z')
    const nextRow = { ...event(), ...editedVersion(old, { test_name: 'CBC with ESR' }, { staffId: 's1' }, new Date(NOW)) }
    const v = buildLedgerView({ rows: { ...before, events: [old, nextRow], evidence: [quote(old), { ...quote(old), eventId: nextRow.id }] }, prev, role: 'clinician', now: NOW })
    expect(v.events.amended.map((i) => i.id)).toEqual([nextRow.id])
    expect(v.events.amended[0]).toMatchObject({ previousId: old.id, status: 'edited', version: 2 })
    expect(v.events.amended[0].fields.find((f) => f.key === 'test_name')).toMatchObject({ value: 'CBC with ESR', edited: true })
    expect(itemsById(v).has(old.id)).toBe(false)
  })
})

describe('ledger categories, conflicts and bulk eligibility (FR-LED-02/05)', () => {
  const d = doc({ docType: 'discharge_summary' })
  const a = event({ documentId: d.id, eventType: 'procedure_documented', fields: { procedure_text: 'Wide local excision' }, eventDate: '2026-10-20' })
  const b = event({ documentId: d.id, eventType: 'procedure_documented', fields: { procedure_text: 'wide local excision' }, eventDate: '2026-10-25' })
  const lab = event({ documentId: d.id, eventDate: '2026-10-21' })
  const old = event({ documentId: d.id, eventDate: '2024-05-01', receivedAt: new Date('2026-10-30T00:00:00Z') })
  const low = event({ documentId: d.id, eventDate: '2026-10-22', fields: { test_name: 'LFT' }, flags: { low_confidence: true } })
  const base = rows({ documents: [d], events: [a, b, lab, old, low], evidence: [quote(a), quote(b), quote(lab), quote(old), quote(low)] })
  const prev = sealed(rows({ documents: [d] }), '2026-10-10T06:00:00Z')

  it('splits new vs newly received older, flags conflicts, and limits Verify all', () => {
    const v = buildLedgerView({ rows: base, prev, role: 'records', now: NOW, viewedByMe: new Set([lab.id]) })
    expect(v.mode).toBe('diff')
    expect(v.events.newly_received_older.map((i) => i.id)).toEqual([old.id])
    expect(v.conflicts).toHaveLength(1)
    const items = itemsById(v)
    expect(items.get(a.id)!.flags).toContain('conflict')
    expect(items.get(a.id)!.tier).toBe('clinician')
    expect(bulkSkipReason(items.get(lab.id))).toBeNull()
    expect(bulkSkipReason(items.get(low.id))).toEqual(['low_confidence'])
    expect(bulkSkipReason(items.get(old.id))).toContain('newly_received_older')
    expect(bulkSkipReason(items.get(a.id))).toContain('conflict')
    expect(bulkSkipReason(undefined)).toEqual(['not_in_record'])
    // Eligible but its source not opened by this person: bulk verify leaves it out.
    const unopened = itemsById(buildLedgerView({ rows: base, prev, role: 'records', now: NOW })).get(lab.id)
    expect(bulkSkipReason(unopened)).toEqual(['source_not_opened'])
    expect(v.counts).toMatchObject({ verified: 0, unverified: 5 })
  })

  it('a clinician resolution (flag on one side) removes the conflict and its marker', () => {
    const resolved = { ...a, flags: { [resolvedKey(b.id)]: true } }
    const v = buildLedgerView({ rows: { ...base, events: [resolved, b, lab, old, low] }, prev, role: 'clinician', now: NOW })
    expect(v.conflicts).toHaveLength(0)
    expect(itemsById(v).get(a.id)!.flags).not.toContain('conflict')
  })

  it('desk gets the headline list only: no quotes, fields or actions', () => {
    const v = buildLedgerView({ rows: base, prev, role: 'desk', now: NOW })
    const i = itemsById(v).get(lab.id)!
    expect(i.sources).toEqual([])
    expect(i.fields).toEqual([])
    expect(i.permits.verify).not.toBe(true)
    expect(JSON.stringify(v)).not.toContain('CBC done on')
  })

  it('diagnosis and history sections: clinician tier, never shown at the desk', () => {
    const dx = event({ documentId: d.id, eventType: 'diagnosis_documented', fields: { section_text: 'Carcinoma of the ascending colon' }, eventDate: '2026-10-21' })
    const withDx = { ...base, events: [...base.events, dx], evidence: [...base.evidence, quote(dx)] }
    expect(itemsById(buildLedgerView({ rows: withDx, prev, role: 'clinician', now: NOW })).get(dx.id)).toMatchObject({ tier: 'clinician', headline: 'Carcinoma of the ascending colon' })
    const desk = buildLedgerView({ rows: withDx, prev, role: 'desk', now: NOW })
    expect(itemsById(desk).has(dx.id)).toBe(false)
    expect(JSON.stringify(desk)).not.toMatch(/Diagnosis as written|Carcinoma/)
  })

  it('desk conflicts and missing items carry no clinical content (S2a)', () => {
    const wording = { en: 'Imaging report not in file for the PET-CT documented on 2 Feb 2026', hi: 'h' }
    const missing = [{ ruleId: 'RAD-IMG-PT-01', ruleVersion: '1', mode: 'production' as const, triggerEventId: a.id, expectedTypes: ['imaging_report'], state: 'expected' as const, dedupeKey: 'k1', matchWindow: { wording } }]
    const desk = buildLedgerView({ rows: { ...base, missing }, prev, role: 'desk', now: NOW })
    expect(desk.conflicts).toHaveLength(1)
    expect(desk.conflicts[0].sides.map((s) => s.value)).toEqual(['—', '—'])
    expect(desk.conflicts[0].label).toBe('Two sources disagree')
    expect(desk.missing).toEqual([{ dedupeKey: 'k1', title: expect.stringMatching(/ not in file$/), state: 'expected', ruleId: '' }])
    const json = JSON.stringify([desk.conflicts.map((c) => ({ ...c, kind: undefined })), desk.missing])
    for (const s of ['PET-CT', 'RAD-IMG', 'procedure', '2026-10-2', 'Oct 2026']) expect(json).not.toContain(s)
    const rec = buildLedgerView({ rows: { ...base, missing }, prev, role: 'records', now: NOW })
    expect(rec.missing[0].title).toBe(wording.en)
    expect(rec.conflicts[0].sides[0].value).not.toBe('—')
  })

  it('initial record mode with no snapshot (FR-LED-06)', () => {
    const v = buildLedgerView({ rows: base, prev: null, role: 'clinician', now: NOW })
    expect(v.mode).toBe('initial')
    expect(v.events.initial_record).toHaveLength(5)
  })
})

describe('seal: canonical JSON, SHA-256, Ed25519, tamper (FR-LED-01, V03-E2E-07)', () => {
  const d = doc()
  const e = event({ documentId: d.id, verificationStatus: 'verified_matches_source' })
  const snap: Snapshot = buildSnapshot(assembleRecord(rows({ events: [e, event({ documentId: d.id })], documents: [d], evidence: [quote(e)] })).record, NOW)
  const sealedRow = () => {
    const s = sealBytes(snap)
    return { id: 'snap', seq: 0, canonicalJson: s.json, sha256: s.sha256, signature: s.signature, keyId: s.keyId, sealedAt: new Date(NOW) }
  }

  it('labels verified and unverified items separately and verifies cleanly', () => {
    expect(snap.verified.map((x) => x.label)).toEqual(['Verified'])
    expect(snap.unverified.map((x) => x.label)).toEqual(['Not yet verified'])
    expect(JSON.stringify(snap)).not.toContain('CBC done on') // quotes are hashed, never stored in the seal
    const v = checkSnapshot(sealedRow())
    expect(v).toMatchObject({ hashMatches: true, signatureValid: true, keyId: 'k-test', counts: { verified: 1, unverified: 1, documents: 1 } })
    expect(sealedRow().canonicalJson).toBe(canonicalJson(JSON.parse(sealedRow().canonicalJson)))
  })

  it('changing one byte breaks the stored hash and the signature', () => {
    const row = sealedRow()
    const i = row.canonicalJson.indexOf('CBC')
    const tampered = { ...row, canonicalJson: row.canonicalJson.slice(0, i) + 'D' + row.canonicalJson.slice(i + 1) }
    const v = checkSnapshot(tampered)
    expect(v.hashMatches).toBe(false)
    expect(v.sha256Recomputed).not.toBe(row.sha256)
    expect(v.signatureValid).toBe(false)
    expect(checkSnapshot({ ...row, keyId: 'k-other' }).signatureValid).toBe(false)
  })
})

describe('timeline (FR-TML-01/03/04)', () => {
  it('groups dated events by year and month, puts undated ones in their own lane, and filters', () => {
    const d1 = doc({ docType: 'imaging_report', institutionName: 'Scan Centre' }), d2 = doc({ documentDate: null })
    const e1 = event({ documentId: d1.id, eventType: 'imaging_report_documented', fields: { test_name: 'CT chest' }, eventDate: '2025-12-03' })
    const e2 = event({ documentId: d2.id, eventDate: '2026-01-15' })
    const e3 = event({ documentId: d2.id, eventDate: null, documentDate: null, datePrecision: 'unknown', verificationStatus: 'verified_matches_source', sourceType: 'internal_document' })
    const r = rows({ documents: [d1, d2], events: [e2, e1, e3], evidence: [quote(e1, 'CT chest on 03/12/2025')] })
    const snap = buildSnapshot(assembleRecord(r).record, NOW)
    const t = buildTimeline(snap, { quoteByHash: new Map([[`h-${e1.id}`, 'CT chest on 03/12/2025']]) })
    expect(t.years.map((y) => y.year)).toEqual(['2025', '2026'])
    expect(t.years[0].months[0]).toMatchObject({ key: '2025-12', label: 'December' })
    expect(t.years[0].months[0].items[0].sources[0]).toMatchObject({ quote: 'CT chest on 03/12/2025', href: `/patients/${P}/documents/${d1.id}?event=${e1.id}` })
    expect(t.undated.map((i) => i.id)).toEqual([e3.id])
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { type: 'imaging_report' }).shown).toBe(1)
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { status: 'verified' }).undated).toHaveLength(1)
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { inst: 'Scan Centre' }).shown).toBe(1)
    // source type (FR-TML-03): this hospital's own paper vs outside documents
    expect(t.facets.sources).toEqual(['external_document', 'internal_document'])
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { source: 'internal_document' }).undated.map((i) => i.id)).toEqual([e3.id])
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { source: 'external_document' })).toMatchObject({ shown: 2, undated: [] })
    expect(buildTimeline(snap, { quoteByHash: new Map() }, { source: 'patient_reported' }).shown).toBe(0)
  })
})

describe('performance (FR-LED-07)', () => {
  it('builds the ledger for 500 events well under 2 s', () => {
    const docs = Array.from({ length: 60 }, (_, i) => doc({ docType: (['discharge_summary', 'lab_report', 'pathology_report', 'chemo_daycare_record'] as const)[i % 4] }))
    const types = ['lab_report_documented', 'procedure_documented', 'chemotherapy_session_documented', 'prescription_documented', 'consultation_documented'] as const
    const evs = Array.from({ length: 500 }, (_, i) => event({
      documentId: docs[i % docs.length].id, eventType: types[i % types.length],
      fields: types[i % types.length] === 'chemotherapy_session_documented' ? { cycle_number: (i % 8) + 1, regimen_text: 'AC' }
        : types[i % types.length] === 'procedure_documented' ? { procedure_text: `procedure ${i % 20}` }
          : types[i % types.length] === 'prescription_documented' ? { medication_names: [`Tab ${i % 30}`] } : { test_name: `Test ${i}` },
      eventDate: new Date(Date.UTC(2024, 0, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10),
      verificationStatus: i % 3 === 0 ? 'verified_matches_source' : 'unverified', flags: i % 17 === 0 ? { low_confidence: true } : {},
    }))
    const r = rows({ documents: docs, events: evs, evidence: evs.map((e) => quote(e)) })
    const prev = sealed({ ...r, events: evs.slice(0, 300) }, '2025-08-01T06:00:00Z')
    const t0 = performance.now()
    const v = buildLedgerView({ rows: r, prev, role: 'clinician', now: NOW })
    const ms = performance.now() - t0
    expect(Object.values(v.events).flat().length + v.duplicates.count).toBeGreaterThan(150)
    expect(ms).toBeLessThan(2000)
    console.info(`ledger build, 500 events: ${ms.toFixed(0)} ms`)
  })
})

describe('timeline hospital facet', () => {
  it('lists one hospital once, whatever its case or spacing, in the nicer casing', async () => {
    const { canonicalInstitutions, institutionKey } = await import('./core')
    const c = canonicalInstitutions(['MADHYAM DAY-CARE ONCOLOGY CENTRE', 'Madhyam Day-Care  Oncology Centre', null, 'Triveni Multispeciality Hospital'])
    expect([...c.values()].sort()).toEqual(['Madhyam Day-Care Oncology Centre', 'Triveni Multispeciality Hospital'])
    expect(institutionKey('  MADHYAM  Day-Care Oncology Centre ')).toBe(institutionKey('Madhyam Day-Care Oncology Centre'))
  })
  it('a shouting name alone is shown in Title Case', async () => {
    const { canonicalInstitutions } = await import('./core')
    expect([...canonicalInstitutions(['KASTURI DAY-CARE UNIT']).values()]).toEqual(['Kasturi Day-Care Unit'])
  })
})
