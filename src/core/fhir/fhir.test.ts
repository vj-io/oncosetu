// FR-ING-ABDM-02: the synthetic ABDM bundles (data/abdm) map to the right events; nothing is inferred.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkStructuredFields, fhirDate, mapBundle, reportKind, resolveRef } from '.'

const load = (f: string) => JSON.parse(readFileSync(join(process.cwd(), 'data/abdm', f), 'utf8'))
const NOW = '2026-11-02T00:00:00.000Z'
const map = (f: string | object) => {
  const r = mapBundle(typeof f === 'string' ? load(f) : f, { now: NOW })
  if (!r.ok) throw new Error(r.reason)
  return r
}
const brief = (r: ReturnType<typeof map>) => r.events.map((e) => ({ type: e.eventType, fields: e.fields, date: e.eventDate, ref: e.fhirRef.split('/')[0] }))

describe('FHIR record types → events', () => {
  it('DiagnosticReportRecord: haematology report → lab_report_documented, performer as institution', () => {
    const r = map('hero-lab-cbc.json')
    expect(r).toMatchObject({ recordType: 'DiagnosticReportRecord', hiType: 'DiagnosticReport', docType: 'lab_report', documentDate: '2026-02-10' })
    expect(brief(r)).toEqual([{ type: 'lab_report_documented', date: '2026-02-10', ref: 'DiagnosticReport',
      fields: { test_name: 'Complete Blood Count (CBC)', institution_name: 'Godavari Diagnostics Laboratory (synthetic)', event_date_text: '2026-02-10T09:15:00+05:30' } }])
  })

  it('DiagnosticReportRecord: radiology category → imaging_report_documented', () => {
    expect(brief(map('hero-imaging-usg.json'))).toEqual([{ type: 'imaging_report_documented', date: '2026-01-22', ref: 'DiagnosticReport',
      fields: { test_name: 'Ultrasound abdomen and pelvis', institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-01-22T11:00:00+05:30' } }])
    expect(map('returning-imaging-ct.json').docType).toBe('imaging_report')
  })

  it('DiagnosticReport kind by category (v2-0074, LOINC part) or imaging LOINC code', () => {
    expect(reportKind({ category: [{ coding: [{ code: 'RAD' }] }] })).toBe('imaging')
    expect(reportKind({ category: [{ coding: [{ code: 'SP' }] }] })).toBe('pathology')
    expect(reportKind({ category: [{ coding: [{ code: 'LP7839-6' }] }] })).toBe('pathology')
    expect(reportKind({ code: { coding: [{ system: 'http://loinc.org', code: '24627-2' }] } })).toBe('imaging')
    expect(reportKind({ category: [{ coding: [{ code: 'CH' }] }] })).toBe('lab')
  })

  it('DischargeSummaryRecord: admission, discharge (Encounter) and the Procedure', () => {
    const r = map('hero-discharge-summary.json')
    expect(r.docType).toBe('discharge_summary')
    expect(brief(r)).toEqual([
      { type: 'admission_documented', date: '2026-03-09', ref: 'Encounter', fields: { institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-03-09T10:00:00+05:30' } },
      { type: 'discharge_documented', date: '2026-03-14', ref: 'Encounter', fields: { institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-03-14T12:30:00+05:30' } },
      { type: 'procedure_documented', date: '2026-03-10', ref: 'Procedure', fields: { procedure_text: 'Wide local excision, left breast', institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-03-10T08:30:00+05:30' } },
    ])
  })

  it('OPConsultRecord: one consultation_documented with doctor, department and encounter date', () => {
    const r = map('hero-op-consult.json')
    expect(r.docType).toBe('consult_note')
    expect(brief(r)).toEqual([{ type: 'consultation_documented', date: '2026-04-02', ref: 'Encounter',
      fields: { doctor_name: 'Dr. Meera Kulkarni (synthetic)', department_text: 'Surgical Oncology OPD', institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-04-02T10:20:00+05:30' } }])
  })

  it('PrescriptionRecord: medication names only, evidence = the Composition section', () => {
    const r = map('hero-prescription.json')
    expect(r.docType).toBe('prescription_printed')
    expect(r.events).toHaveLength(1)
    expect(r.events[0].fields).toEqual({
      medication_names: ['Letrozole 2.5 mg tablet', 'Calcium carbonate 500 mg + Vitamin D3 tablet'], prescriber_name: 'Dr. Meera Kulkarni (synthetic)',
      institution_name: 'Godavari Multispeciality Hospital (synthetic)', event_date_text: '2026-04-02T10:45:00+05:30',
    })
    expect(r.events[0].fhirRef).toBe(`Composition/${r.compositionId}#440545006`)
    expect(resolveRef(load('hero-prescription.json'), r.events[0].fhirRef)).toMatchObject({ title: 'Prescription' })
    expect(resolveRef(load('hero-discharge-summary.json'), map('hero-discharge-summary.json').events[2].fhirRef)).toMatchObject({ resourceType: 'Procedure' })
  })
})

describe('nothing is inferred (FR-EXT-05)', () => {
  it('stage, grade, conclusions, observation values and dosage in the bundles never reach an event', () => {
    const all = JSON.stringify(['hero-lab-cbc.json', 'hero-imaging-usg.json', 'hero-discharge-summary.json', 'hero-op-consult.json', 'hero-prescription.json']
      .map((f) => map(f).events.map((e) => e.fields)))
    for (const s of ['Stage IIA', 'Grade 2', 'Mild anaemia', 'Impression', '10.9', 'Low', 'once daily', '1-0-1', 'Paracetamol', 'Follow-up', 'Left breast lump']) {
      expect(all).not.toContain(s)
    }
  })

  it.each(['stage', 'tnm_stage', 'grade', 'response', 'dose', 'dosage', 'diagnosis', 'impression', 'conclusion', 'recommendation', 'risk_score'])(
    'the gate field rules reject a %s field', (key) => {
      expect(checkStructuredFields('procedure_documented', { procedure_text: 'Wide local excision', [key]: 'x' })).toMatchObject({ ok: false, reason: 'forbidden_field', detail: key })
    })

  it('the per-type allow-list and value types apply too; valid fields pass', () => {
    expect(checkStructuredFields('prescription_documented', { medication_names: ['A'], frequency_text: '1-0-1' })).toMatchObject({ ok: false, reason: 'field_not_allowed' })
    expect(checkStructuredFields('lab_report_documented', { test_name: '' })).toMatchObject({ ok: false, reason: 'invalid_field_value' })
    expect(checkStructuredFields('patient_statement', { statement_text: 'x' })).toMatchObject({ ok: false, reason: 'event_type_not_extractable' })
    expect(checkStructuredFields('prescription_documented', { medication_names: ['Letrozole 2.5 mg tablet'], prescriber_name: 'Dr X' })).toEqual({ ok: true })
  })

  it('an event that fails the field rules is rejected, not written', () => {
    const b = load('hero-lab-cbc.json')
    const dr = b.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'DiagnosticReport').resource
    dr.code = { text: '   ' } // blank name: dropped, the event keeps its other fields
    expect(map(b).events[0].fields.test_name).toBeUndefined()
  })
})

describe('dates and refusals', () => {
  it('FHIR date / dateTime → IST calendar day with precision', () => {
    expect(fhirDate('2026-03-09T20:00:00Z')).toEqual({ iso: '2026-03-10', precision: 'day', raw: '2026-03-09T20:00:00Z' })
    expect(fhirDate('2026-03-09')).toMatchObject({ iso: '2026-03-09', precision: 'day' })
    expect(fhirDate('2026-03')).toMatchObject({ iso: '2026-03-01', precision: 'month' })
    expect(fhirDate('2026')).toMatchObject({ iso: '2026-01-01', precision: 'year' })
    for (const bad of ['2026-02-30', '12/03/2026', '', null, 2026]) expect(fhirDate(bad)).toBeNull()
  })

  it('undated and future-dated resources are flagged, never guessed', () => {
    const b = load('hero-op-consult.json')
    const enc = b.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Encounter').resource
    enc.period.start = '2027-01-05T10:00:00+05:30'
    expect(map(b).events[0]).toMatchObject({ eventDate: '2027-01-05', dateFlags: ['date_future'] })
    delete enc.period.start
    delete b.entry[0].resource.date
    expect(map(b).events[0]).toMatchObject({ eventDate: null, datePrecision: 'unknown', dateFlags: ['date_unknown'] })
  })

  it('refuses what is not an ABDM document bundle', () => {
    expect(mapBundle({ resourceType: 'Bundle', type: 'collection' })).toEqual({ ok: false, reason: 'not_a_document_bundle' })
    expect(mapBundle({ resourceType: 'Bundle', type: 'document', entry: [{ resource: { resourceType: 'Patient' } }] })).toEqual({ ok: false, reason: 'no_composition' })
    const b = load('hero-op-consult.json')
    b.entry[0].resource.meta = {}
    b.entry[0].resource.type = { coding: [{ system: 'http://snomed.info/sct', code: '419891008' }] }
    expect(mapBundle(b)).toEqual({ ok: false, reason: 'unknown_record_type' })
  })

  it('record type from the SNOMED Composition.type when no profile is declared', () => {
    const b = load('hero-prescription.json')
    b.entry[0].resource.meta = {}
    b.meta.profile = []
    expect(map(b).recordType).toBe('PrescriptionRecord')
  })
})
