// Desk: the patient (or guardian or caregiver) signs the consent form at the desk, with the desk staff member as witness.
// Signs the consent as it stands (record it first through the consent steps); a signed withdrawal needs the withdrawal recorded first.
import { z } from 'zod'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { createSignedConsent } from '@/server/privacy/sign'
import { patientIdParam } from '@/server/registration/http'

const PNG_PREFIX = 'data:image/png;base64,'
const NONE = { store: false, ai: false, share: false, abdm: false, metrics: false, team: false }

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], maxBytes: 600_000,
  body: z.object({
    signerName: z.string().trim().min(2).max(120), relation: z.enum(['self', 'guardian', 'caregiver']), method: z.enum(['drawn', 'typed']),
    signature: z.string().max(400_000).optional(), withdraw: z.boolean().default(false), lang: z.enum(['en', 'hi', 'hinglish']).default('en'),
  }),
}, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const b = ctx.body
  const png = b.method === 'drawn' && b.signature?.startsWith(PNG_PREFIX) ? new Uint8Array(Buffer.from(b.signature.slice(PNG_PREFIX.length), 'base64')) : null
  const { staffName } = ctx.session
  const r = await createSignedConsent(ctx.db, {
    orgId: ctx.session.orgId, patientId, relation: b.relation, signerName: b.signerName, method: b.method, signaturePng: png, withdraw: b.withdraw,
    purposes: NONE, lang: b.lang, actor: { kind: b.relation === 'self' ? 'patient' : 'caregiver', id: patientId },
    witness: { staffId: ctx.session.staffId, name: staffName }, recordChoices: false,
  })
  await ctx.audit(b.withdraw ? 'consent.sign_withdraw' : 'consent.sign', 'signed_consent', r.id, { relation: b.relation, method: b.method, witnessed: true, formVersion: 'consent-form-draft-v1' })
  return { ok: true, id: r.id }
})
