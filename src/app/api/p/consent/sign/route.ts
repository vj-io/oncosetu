// A patient or caregiver signs the consent form on screen (drawn signature, or a typed name). Records the choices like the
// normal consent route, stores the signed PDF with the patient's documents, and audit-logs it. DRAFT form.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { caregivers } from '@/db/schema'
import { route } from '@/server/http'
import { createSignedConsent } from '@/server/privacy/sign'

const purposes = z.object({ store: z.boolean(), ai: z.boolean(), share: z.boolean(), abdm: z.boolean(), metrics: z.boolean(), team: z.boolean().default(false) })
const PNG_PREFIX = 'data:image/png;base64,'

export const POST = route({
  auth: 'patient', maxBytes: 600_000,
  body: z.object({
    signerName: z.string().trim().min(2).max(120), method: z.enum(['drawn', 'typed']), signature: z.string().max(400_000).optional(),
    withdraw: z.boolean().default(false), purposes, lang: z.enum(['en', 'hi', 'hinglish']).default('en'),
  }),
}, async ({ session, db, body, audit }) => {
  let relation: 'self' | 'guardian' | 'caregiver' = 'self'
  if (session.kind === 'caregiver' && session.caregiverId) {
    const [cg] = await db.select({ g: caregivers.isGuardian }).from(caregivers).where(eq(caregivers.id, session.caregiverId))
    relation = cg?.g ? 'guardian' : 'caregiver'
  }
  const png = body.method === 'drawn' && body.signature?.startsWith(PNG_PREFIX) ? new Uint8Array(Buffer.from(body.signature.slice(PNG_PREFIX.length), 'base64')) : null
  const withdraw = body.withdraw || !body.purposes.store
  const r = await createSignedConsent(db, {
    orgId: session.orgId, patientId: session.patientId, relation, signerName: body.signerName, method: body.method, signaturePng: png, withdraw,
    purposes: withdraw ? { store: false, ai: false, share: false, abdm: false, metrics: false, team: false } : body.purposes, lang: body.lang,
    actor: { kind: session.kind, id: session.caregiverId ?? session.patientId }, recordChoices: true,
  })
  await audit(withdraw ? 'consent.sign_withdraw' : 'consent.sign', 'signed_consent', r.id, { relation, method: body.method, formVersion: 'consent-form-draft-v1' })
  return { ok: true, id: r.id }
})
