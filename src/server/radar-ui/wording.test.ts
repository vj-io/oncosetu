import { describe, expect, it } from 'vitest'
import { istDate, lintText } from '@/core/copy'
import { runRadar } from '@/core/radar'
import type { CoreDocument, CoreEvent, CoreStatement, DocType, EventType, FieldValue } from '@/core/types'
import { groupedCycles, missingWording, type WordingTrigger } from './wording'

const NOW = '2026-11-02T06:00:00Z'
const ev = (id: string, eventType: EventType, fields: Record<string, FieldValue>, eventDate: string | null, documentId: string, documentDate: string | null = null): CoreEvent => ({
  id, eventType, fields, eventDate, datePrecision: eventDate ? 'day' : 'unknown', documentDate, receivedAt: '2026-10-01T10:00:00Z',
  documentId, sourceType: 'external_document', extractionMethod: 'text_layer', verificationStatus: 'unverified', flags: [], version: 1,
  evidence: [{ documentId, pageNo: 2, charStart: 0, charEnd: 10, quote: 'x', quoteSha256: 'h' }],
})
const doc = (id: string, docType: DocType, documentDate: string | null): CoreDocument => ({ id, docType, documentDate, receivedAt: '2026-10-01T10:00:00Z', institution: 'City Hospital' })

const docs = [doc('d-ds', 'discharge_summary', '2026-03-16'), doc('d-cn', 'consult_note', '2026-04-02'), doc('d-c2', 'chemo_daycare_record', '2026-05-01'), doc('d-c4', 'chemo_daycare_record', '2026-06-12')]
const events = [
  ev('e1', 'procedure_documented', { procedure_text: 'wide local excision' }, '2026-03-12', 'd-ds'),
  ev('e2', 'report_pending_documented', { test_name: 'IHC' }, '2026-03-16', 'd-ds'),
  ev('e3', 'report_pending_documented', { test_name: 'PET-CT' }, null, 'd-cn', '2026-04-02'),
  ev('e4', 'admission_documented', {}, '2026-04-01', 'd-cn'),
  ev('e5', 'chemotherapy_session_documented', { cycle_number: 2 }, '2026-05-01', 'd-c2'),
  ev('e6', 'chemotherapy_session_documented', { cycle_number: 4 }, '2026-06-12', 'd-c4'),
  ev('e7', 'radiotherapy_documented', { status_text: 'completed' }, '2026-04-02', 'd-cn'),
  ev('e8', 'referral_documented', { referred_to_text: 'AIIMS New Delhi' }, '2026-04-02', 'd-cn'),
  ev('e9', 'molecular_test_documented', { test_name: 'EGFR', status_text: 'sent' }, '2026-04-02', 'd-cn'),
]
const statements: CoreStatement[] = [{ id: 's1', questionId: 'new_tests', transcript: 'scan at another hospital', language: 'en', confirmation: 'patient_confirmed', capturedAt: '2026-10-20T05:00:00Z', scanNames: ['MRI'] }]

function triggerOf(id: string): WordingTrigger {
  const s = statements.find((x) => x.id === id)
  if (s) return { kind: 'statement', fields: { statement_text: s.transcript, scan_name: s.scanNames ?? [] }, eventDate: s.statedDate ?? istDate(s.capturedAt), datePrecision: 'day', documentDate: null, pageNo: null, docType: null }
  const e = events.find((x) => x.id === id)!
  return { kind: 'event', fields: e.fields, eventDate: e.eventDate, datePrecision: e.datePrecision, documentDate: e.documentDate, pageNo: e.evidence[0].pageNo, docType: docs.find((d) => d.id === e.documentId)!.docType }
}

describe('missingWording', () => {
  const { items } = runRadar({ events, documents: docs, statements, now: NOW })

  it('rebuilds exactly what runRadar says, for every rule that fired', () => {
    expect(new Set(items.map((i) => i.ruleId)).size).toBeGreaterThanOrEqual(8)
    for (const it of items) {
      const got = missingWording(it.ruleId, it.expectedTypes, triggerOf(it.triggerEventId), it.grouped?.cycles ?? [])
      expect(got).toEqual({ wording: it.wording, neutral: it.neutralWording })
    }
  })

  it('groups chemo cycles (E-RAD-04) and keeps neutral wording clean', () => {
    const chemo = items.find((i) => i.ruleId === 'RAD-CHEMO-PRIOR-01')!
    expect(chemo.grouped?.cycles).toEqual([1, 3])
    for (const it of items) {
      const { neutral } = missingWording(it.ruleId, it.expectedTypes, triggerOf(it.triggerEventId), it.grouped?.cycles ?? [])
      expect(lintText(`${neutral.en} ${neutral.hi}`, ['diagnosis', 'radar'])).toEqual([])
    }
  })

  it('falls back to a plain document sentence without a rule or trigger', () => {
    const r = missingWording('RAD-UNKNOWN', ['pathology_report'], null, [])
    expect(r.neutral.en).toBe('Laboratory report (tissue) not in file.')
    expect(r.wording.en).toBe('Histopathology report not in file.')
  })

  it('reads stored cycle shapes', () => {
    expect(groupedCycles([3, 1, 2])).toEqual([1, 2, 3])
    expect(groupedCycles({ cycles: [2, 1] })).toEqual([1, 2])
    expect(groupedCycles([{ cycles: [4] }])).toEqual([4])
    expect(groupedCycles(null)).toEqual([])
  })
})
