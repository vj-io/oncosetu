import { describe, expect, it } from 'vitest'
import { describeAction, describeDetails, describeTarget } from './audit-words'

describe('describeAction', () => {
  it('names the common entries', () => {
    expect(describeAction('event.source_viewed')).toBe('Opened the page behind a fact')
    expect(describeAction('snapshot.seal')).toBe('Visit sealed')
  })
  it('never prints a raw code for an unknown entry', () => {
    const t = describeAction('some.new_thing')
    expect(t).toBe('Some new thing')
    expect(t).not.toMatch(/[._]/)
  })
  it('handles an empty action', () => {
    expect(describeAction('')).toBe('Activity')
  })
  it('names targets', () => {
    expect(describeTarget('share_link')).toBe('Share link')
    expect(describeTarget(null)).toBe('—')
    expect(describeTarget('odd_kind')).toBe('Odd kind')
  })
  it('has a plain label for the admin actions that used to print as code', () => {
    for (const a of ['audit.verify_chain', 'settings.demo_clock', 'rule.mark_reviewed', 'request.patient_letter', 'staff.role_change']) expect(describeAction(a)).not.toMatch(/(verify|chain|demo|lint)|[._]/)
    expect(describeAction('audit.verify_chain')).toBe('Whole log checked for changes')
  })
  it('shows details as plain pairs and turns a patient id into its record code', () => {
    const d = describeDetails({ lang: 'en', patientId: '01a1f4dd-67e4-7000-8000-0000000b7f39', institutionType: null, patientNotified: true }, () => 'OS·B7F399')
    expect(d).toEqual([{ key: 'Language', value: 'en' }, { key: 'Record', value: 'OS·B7F399' }, { key: 'Patient told', value: 'yes' }])
  })
})
