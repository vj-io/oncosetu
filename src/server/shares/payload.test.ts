import { describe, expect, it } from 'vitest'
import { formatDateIN, istDate, lintText } from '@/core/copy'
import { buildSnapshot } from '@/core/ledger'
import type { CoreDocument, CoreEvent, EventType, FieldValue } from '@/core/types'
import { ts } from '@/i18n/shares'
import { buildSharePayload, type PayloadInput } from './payload'

const ev = (id: string, eventType: EventType, fields: Record<string, FieldValue>, eventDate: string, documentId: string, verificationStatus: CoreEvent['verificationStatus'] = 'unverified'): CoreEvent => ({
  id, eventType, fields, eventDate, datePrecision: 'day', documentDate: null, receivedAt: '2026-10-01T10:00:00Z', documentId,
  sourceType: 'external_document', extractionMethod: 'text_layer', verificationStatus, flags: [], version: 1,
  evidence: [{ documentId, pageNo: 2, charStart: 0, charEnd: 30, quote: 'wide local excision for carcinoma', quoteSha256: 'h1' }],
})
const docs: CoreDocument[] = [
  { id: 'd-ds', docType: 'discharge_summary', documentDate: '2026-03-16', receivedAt: '2026-10-01T10:00:00Z', institution: 'Regional Cancer Centre', sha256: 'aa' },
  { id: 'd-dc', docType: 'chemo_daycare_record', documentDate: '2026-06-12', receivedAt: '2026-10-01T10:00:00Z', institution: 'City Hospital', sha256: 'bb' },
]
const events = [
  ev('e1', 'procedure_documented', { procedure_text: 'wide local excision', institution_name: 'Regional Cancer Centre' }, '2026-03-12', 'd-ds', 'verified_matches_source'),
  ev('e2', 'chemotherapy_session_documented', { cycle_number: 4, regimen_text: 'AC chemotherapy' }, '2026-06-12', 'd-dc', 'verified_matches_source'),
  ev('e3', 'admission_documented', {}, '2026-03-10', 'd-ds'),
]
const missing = [{
  dedupeKey: 'k1', ruleId: 'RAD-SURG-HPE-01', ruleVersion: 1, triggerEventId: 'e1', expectedTypes: ['pathology_report' as const], mode: 'production' as const,
  wording: { en: 'Histopathology report not in file for the procedure documented on 12 Mar 2026 (Discharge summary, p.2).', hi: 'हिस्टोपैथोलॉजी रिपोर्ट फ़ाइल में नहीं है' },
}]
const snapshot = buildSnapshot({ patientId: 'p1', events, documents: docs, statements: [], missing }, '2026-10-20T06:00:00.000Z')

const base: PayloadInput = {
  snapshot, snapshotId: 's-1', sha256: 'f'.repeat(64), disclosure: 'not_cleared', scope: 'index',
  verifiers: { e1: 'records', e2: 'clinician' },
  quotes: { e1: 'wide local excision for carcinoma' },
  absentNeutral: { k1: { en: 'Laboratory report (tissue) not in file for an item documented on 12 Mar 2026.', hi: '12 मार्च 2026 को दर्ज एक प्रविष्टि के लिए प्रयोगशाला रिपोर्ट (ऊतक) फ़ाइल में नहीं है।' } },
}

describe('share payload (FR-PAS-01, FR-CON-07)', () => {
  it('not_cleared: zero diagnosis words, no quotes, brand Setu Records', () => {
    for (const disclosure of ['not_cleared', 'unknown'] as const) {
      const p = buildSharePayload({ ...base, disclosure })
      const text = JSON.stringify(p)
      expect(lintText(text, ['diagnosis'])).toEqual([])
      expect(text).not.toContain('excision')
      expect(text).not.toContain('Regional')
      expect(p.items.every((i) => !i.quote)).toBe(true)
      expect(p.brand).toBe('Setu Records')
      // FR-PAS-03, in the PRD's words; the brand stays neutral until disclosure is cleared (FR-CON-07)
      expect(p.notice.en).toBe('This summary contains only records provided to Setu Records. It is a list of documents, not a clinical summary.')
      expect(p.notice.hi).toContain('केवल वे रिकॉर्ड हैं जो Setu Records को दिए गए')
      expect(p.notice.hinglish).toContain('sirf woh records hain jo Setu Records ko diye gaye')
    }
  })

  it('has the heading, the as-of date, provenance per line and the absent-documents list', () => {
    const p = buildSharePayload(base)
    expect(p.heading.en).toBe('Document index, not a clinical summary')
    expect(p.asOf).toBe('2026-10-20T06:00:00.000Z') // the seal time: the viewer shows "As of 20 Oct 2026 (sealed record)"
    expect(ts('en', 'asOf', { date: formatDateIN(istDate(p.asOf), 'en') })).toBe('As of 20 Oct 2026 (sealed record)')
    expect(buildSharePayload({ ...base, disclosure: 'cleared' }).notice.en).toBe('This summary contains only records provided to OncoSetu. It is a list of documents, not a clinical summary.')
    expect(p.items).toHaveLength(3)
    expect(p.items.map((i) => i.date)).toEqual(['2026-03-10', '2026-03-12', '2026-06-12'])
    expect(p.items[1]).toMatchObject({ label: { en: 'Procedure note' }, source: { documentId: 'd-ds', page: 2, label: { en: 'Hospital discharge summary' } }, verification: 'records', institution: null })
    expect(p.items[2]).toMatchObject({ label: { en: 'Day-care record' }, verification: 'clinician', institution: 'City Hospital' })
    expect(p.items[0].verification).toBe('unverified')
    expect(p.documents.map((d) => d.label.en)).toEqual(['Hospital discharge summary', 'Day-care record'])
    expect(p.absent).toEqual([{ state: 'expected', text: base.absentNeutral.k1 }])
    expect(p.seal).toEqual({ snapshotId: 's-1', sha256: 'f'.repeat(64), verifyPath: '/verify/s-1' })
    expect(JSON.stringify(p)).not.toContain('AC chemotherapy') // event fields never leave
  })

  it('diagnosis and history sections never leave in a share, even when cleared', () => {
    const dx = ev('e4', 'diagnosis_documented', { section_text: 'Invasive carcinoma' }, '2026-03-18', 'd-ds', 'verified_matches_source')
    const snap = buildSnapshot({ patientId: 'p1', events: [...events, dx], documents: docs, statements: [], missing }, '2026-10-20T06:00:00.000Z')
    const p = buildSharePayload({ ...base, snapshot: snap, disclosure: 'cleared', scope: 'index_with_quotes', quotes: { ...base.quotes, e4: 'Invasive carcinoma' } })
    expect(p.items).toHaveLength(3)
    expect(JSON.stringify(p)).not.toContain('Invasive carcinoma')
  })

  it('quotes only when cleared and asked for', () => {
    expect(() => buildSharePayload({ ...base, scope: 'index_with_quotes' })).toThrow()
    const p = buildSharePayload({ ...base, disclosure: 'cleared', scope: 'index_with_quotes' })
    expect(p.brand).toBe('OncoSetu')
    expect(p.items.find((i) => i.verification === 'records')?.quote).toBe('wide local excision for carcinoma')
    expect(p.absent[0].text.en).toMatch(/^Histopathology report not in file/)
    expect(buildSharePayload({ ...base, disclosure: 'cleared' }).items.every((i) => !i.quote)).toBe(true)
  })
})

describe('errata in the share and the passport (FR-ID-06)', () => {
  it('a document taken out after the previous seal is listed with a neutral label; none → no errata key', () => {
    const detached = docs.map((d) => (d.id === 'd-dc' ? { ...d, detachedAt: '2026-10-25T09:00:00.000Z' } : d))
    const next = buildSnapshot({ patientId: 'p1', events, documents: detached, statements: [], missing }, '2026-10-26T06:00:00.000Z', snapshot)
    const p = buildSharePayload({ ...base, snapshot: next })
    expect(p.errata).toEqual([{ label: { en: 'Day-care record', hi: 'डे-केयर रिकॉर्ड', hinglish: expect.any(String) }, date: '2026-10-25T09:00:00.000Z', withdrawn: 1 }])
    expect(lintText(JSON.stringify(p.errata), ['diagnosis'])).toEqual([])
    expect(p.documents.map((d) => d.id)).toEqual(['d-ds'])
    expect(buildSharePayload(base)).not.toHaveProperty('errata')
    expect(ts('en', 'errataLine', { label: p.errata![0].label.en, date: formatDateIN(istDate(p.errata![0].date!)), n: 1 })).toBe('Day-care record · taken out on 25 Oct 2026 · items withdrawn: 1')
  })
})
