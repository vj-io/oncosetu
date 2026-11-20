import { describe, expect, it } from 'vitest'
import { breakGlassReviewer, reviewState } from './ops'

const base = { reviewedAt: null, grantStaffId: 'a1', viewerId: 'a2', activeAdminIds: ['a1', 'a2'] }

describe('who may review an emergency-access grant', () => {
  it('another administrator can always review', () => {
    expect(reviewState({ ...base, viewerRole: 'org_admin' }).kind).toBe('can_review')
  })
  it('nobody reviews their own grant, and a sole administrator is told to ask the auditor', () => {
    const st = reviewState({ ...base, viewerId: 'a1', viewerRole: 'org_admin', activeAdminIds: ['a1'] })
    expect(st.kind).toBe('waiting')
    expect(st.kind === 'waiting' && st.text).toMatch(/auditor/)
  })
  it('with two administrators, an own grant waits for the other one', () => {
    const st = reviewState({ ...base, viewerId: 'a1', viewerRole: 'org_admin' })
    expect(st.kind === 'waiting' && st.text).toMatch(/another administrator/)
  })
  it('an auditor reviews only when no other administrator exists', () => {
    expect(reviewState({ ...base, viewerId: 'u9', viewerRole: 'auditor' }).kind).toBe('waiting')
    expect(reviewState({ ...base, viewerId: 'u9', viewerRole: 'auditor', activeAdminIds: ['a1'] }).kind).toBe('can_review')
    expect(breakGlassReviewer({ grantStaffId: 'a1', activeAdminIds: ['a1', 'a2'] }).auditors).toBe(false)
    expect(breakGlassReviewer({ grantStaffId: 'a1', activeAdminIds: ['a1'] }).auditors).toBe(true)
  })
  it('a reviewed grant is done; other roles never review', () => {
    expect(reviewState({ ...base, reviewedAt: new Date(), viewerRole: 'org_admin' }).kind).toBe('done')
    expect(reviewState({ ...base, viewerId: 'c1', viewerRole: 'clinician' }).kind).toBe('waiting')
  })
})
