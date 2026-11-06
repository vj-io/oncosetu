// Consent toggles and one-tap withdrawal (FR-CON-04). Takes effect on the next request: every use re-reads the latest row.
import { z } from 'zod'
import { HttpError, route } from '@/server/http'
import { NO_PURPOSES, recordConsent } from '@/server/portal/consent'

const purposes = z.object({ store: z.boolean(), ai: z.boolean(), share: z.boolean(), abdm: z.boolean(), metrics: z.boolean() })

export const POST = route({
  auth: 'patient',
  body: z.object({ withdraw: z.boolean().optional(), purposes: purposes.optional(), lang: z.enum(['en', 'hi', 'hinglish']).default('en') }),
}, async ({ session, db, body, audit }) => {
  if (!body.withdraw && !body.purposes) throw new HttpError(400, 'invalid_request', 'Nothing to change')
  // Without "store" there is no record to keep: turning it off is a withdrawal (same rule as the desk's consent tab).
  const withdraw = !!body.withdraw || !body.purposes?.store
  const next = withdraw ? NO_PURPOSES : body.purposes!
  const { sharesRevoked, erasureCancelled } = await recordConsent(db, {
    orgId: session.orgId, patientId: session.patientId, lang: body.lang,
    actor: { kind: session.kind, id: session.caregiverId ?? session.patientId },
  }, next, withdraw)
  await audit(withdraw ? 'consent.withdraw' : 'consent.update', 'patient', session.patientId, { sharesRevoked, ...next })
  for (const id of erasureCancelled) await audit('erasure.cancel', 'erasure_request', id, { patientId: session.patientId, reason: 'consent_restored' })
  return { ok: true, purposes: next, withdrawn: withdraw, sharesRevoked }
})
