// Card lost or stolen (FR-ID-08): the patient, or the caregiver who holds the card, stops it from the portal. The old QR
// then answers "revoked" at the desk; the desk issues a new card in person (POST /api/patients/[id]/token).
import { route } from '@/server/http'
import { revokeToken } from '@/server/registration/token'

export const POST = route({ auth: 'patient' }, async ({ session, db, audit }) => {
  await revokeToken(db, audit, session.patientId, 'patient')
  return { ok: true, revoked: true }
})
