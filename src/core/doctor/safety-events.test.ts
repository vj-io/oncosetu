import { describe, expect, it } from 'vitest'
import { describeSafety, SAFETY_KINDS, SAFETY_META, tally, type RawSafety } from './safety-events'

const base = { at: new Date('2026-11-01T10:00:00Z'), patientId: 'p1' }
const audit = (action: string, details: Record<string, unknown> = {}, extra: Partial<RawSafety> = {}): RawSafety => ({ source: 'audit', action, details, actorRole: 'clinician', ...base, ...extra })

describe('describeSafety', () => {
  it('describes held documents', () => {
    const doc = (d: Partial<NonNullable<RawSafety['doc']>>): RawSafety => ({ source: 'document', doc: { identityResult: 'match', handwritten: false, injectionFlag: false, ...d }, ...base })
    expect(describeSafety(doc({ identityResult: 'mismatch' }))?.kind).toBe('wrong_patient')
    expect(describeSafety(doc({ injectionFlag: true }))?.kind).toBe('hidden_instructions')
    expect(describeSafety(doc({ handwritten: true }))?.kind).toBe('handwriting')
    expect(describeSafety(doc({}))).toBeNull()
  })
  it('separates a role refusal from a consent refusal', () => {
    expect(describeSafety(audit('access.refused', { reason: 'forbidden' }, { actorRole: 'auditor' }))?.kind).toBe('role_refused')
    expect(describeSafety(audit('access.refused', { reason: 'consent_required' }))?.kind).toBe('no_consent')
    expect(describeSafety(audit('access.refused', { reason: 'verification_required' }))?.kind).toBe('no_consent')
  })
  it('shows the break-glass reason', () => {
    expect(describeSafety(audit('break_glass.granted', {}, { reason: 'Unconscious in emergency' }))?.detail).toContain('Unconscious in emergency')
  })
  it('lists refused share opens but not successful ones', () => {
    expect(describeSafety({ source: 'share_view', outcome: 'wrong_passcode', ...base })?.detail).toContain('wrong passcode')
    expect(describeSafety({ source: 'share_view', outcome: 'viewed', ...base })).toBeNull()
  })
  it('only reports an SMS limit when the code was not sent', () => {
    expect(describeSafety(audit('desk.otp_requested', { outcome: 'locked' }))?.kind).toBe('sms_limit')
    expect(describeSafety(audit('desk.otp_requested', { outcome: 'sent' }))).toBeNull()
  })
  it('maps a signed withdrawal and a blocked sign-in code', () => {
    expect(describeSafety(audit('consent.sign_withdraw', {}, { actorRole: 'patient' }))?.kind).toBe('consent_withdrawn')
    expect(describeSafety(audit('consent.withdraw', {}, { actorRole: 'patient' }))?.kind).toBe('consent_withdrawn')
    expect(describeSafety(audit('auth.otp_limited', { outcome: 'locked' }, { actorRole: 'patient' }))?.kind).toBe('sms_limit')
    expect(describeSafety(audit('auth.otp_blocked', { reason: 'limit' }, { actorRole: 'patient' }))?.kind).toBe('sms_limit')
  })
  it('maps uploads, duplicates, consent and erasure', () => {
    expect(describeSafety(audit('document.quarantined'))?.kind).toBe('upload_rejected')
    const rej = describeSafety(audit('document.upload_rejected', { reason: 'zip_bomb' }))
    expect(rej).toMatchObject({ kind: 'upload_rejected', title: 'Upload rejected (unsafe or unsupported file)' })
    expect(rej?.detail).toMatch(/ZIP expanded far too much/)
    expect(describeSafety(audit('document.upload_rejected', {}))?.detail).toMatch(/refused/)
    expect(describeSafety(audit('document.duplicate_upload'))?.kind).toBe('duplicate_upload')
    expect(describeSafety(audit('consent.withdrawn'))?.kind).toBe('consent_withdrawn')
    expect(describeSafety(audit('erasure.executed', {}, { actorRole: 'system' }))?.kind).toBe('erasure_done')
  })
  it('ignores unrelated audit rows', () => {
    expect(describeSafety(audit('document.view'))).toBeNull()
  })
  it('never shows an event code in the words', () => {
    const rows = [audit('access.refused', { reason: 'forbidden' }), audit('share.locked'), audit('document.quarantined'), audit('erasure.executed')]
    for (const r of rows) {
      const e = describeSafety(r)!
      expect(`${e.title} ${e.detail} ${e.who}`).not.toMatch(/[a-z]+_[a-z]+|[a-z]+\.[a-z]+/)
    }
  })
  it('tallies every kind and explains each', () => {
    const t = tally([{ kind: 'handwriting' }, { kind: 'handwriting' }])
    expect(t.handwriting).toBe(2)
    expect(Object.keys(t)).toHaveLength(SAFETY_KINDS.length)
    for (const k of SAFETY_KINDS) expect(SAFETY_META[k].explain.length).toBeGreaterThan(20)
  })
})
