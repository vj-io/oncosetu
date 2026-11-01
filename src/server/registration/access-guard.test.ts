// S1 regression: every patient-level mutation runs assertPatientAccess BEFORE it touches the database, so a desk
// session cannot add its own phone as a caregiver (or change contacts, consent, disclosure…) for an unverified patient.
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import { addCaregiver, revokeCaregiver } from './caregivers'
import { recordConsent, withdrawConsentRoute } from './consent'
import { grantBreakGlass, setDeceased, setDisclosure, setPrimaryContact, transferControl } from './patient-admin'

vi.mock('../patients', async (orig) => ({
  ...(await orig<typeof import('../patients')>()),
  assertPatientAccess: vi.fn(async () => { throw new HttpError(403, 'verification_required', 'Verify the patient at the desk first') }),
}))

const PID = '0190a3c2-0000-7000-8000-000000000001'
const ctx = () => ({
  db: new Proxy({}, { get() { throw new Error('db touched before the access check') } }),
  session: { kind: 'staff', staffId: 's1', orgId: 'o1', role: 'desk' },
  body: {}, audit: vi.fn(),
}) as never
const denied = { status: 403, code: 'verification_required' }

describe('patient-level mutations check access first (S1)', () => {
  const guarded: [string, () => Promise<unknown>][] = [
    ['addCaregiver', () => addCaregiver(ctx(), PID)],
    ['revokeCaregiver', () => revokeCaregiver(ctx(), PID, PID)],
    ['setDisclosure', () => setDisclosure(ctx(), PID)],
    ['setPrimaryContact', () => setPrimaryContact(ctx(), PID)],
    ['setDeceased', () => setDeceased(ctx(), PID)],
    ['transferControl', () => transferControl(ctx(), PID)],
    ['recordConsent', () => recordConsent(ctx(), PID)],
    ['withdrawConsentRoute', () => withdrawConsentRoute(ctx(), PID)],
  ]
  it.each(guarded)('%s is refused before any read or write', async (_, call) => {
    await expect(call()).rejects.toMatchObject(denied)
  })

  it('consent recording accepts a verified visit in place of the missing consent', async () => {
    vi.mocked(assertPatientAccess).mockClear()
    await expect(recordConsent(ctx(), PID)).rejects.toMatchObject(denied)
    expect(assertPatientAccess).toHaveBeenCalledWith(expect.anything(), PID, { consentOptional: true })
  })

  it('break-glass is the way in when consent is absent, so it does not require access first', async () => {
    vi.mocked(assertPatientAccess).mockClear()
    await expect(grantBreakGlass(ctx(), PID)).rejects.toThrow('db touched before the access check')
    expect(assertPatientAccess).not.toHaveBeenCalled()
  })
})
