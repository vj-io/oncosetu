// The signed consent PDF, to print or save. Staff who can open the record, or the patient or caregiver themselves. Audited, never cached.
import { eq } from 'drizzle-orm'
import { signedConsents } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { readSignedPdf } from '@/server/privacy/sign'
import { patientIdParam } from '@/server/registration/http'

export const GET = route({ auth: 'any' }, async (ctx) => {
  const id = patientIdParam(ctx)
  if (ctx.session.kind === 'staff' && !['desk', 'records', 'clinician'].includes(ctx.session.role)) throw new HttpError(403, 'forbidden', 'Not allowed')
  const [row] = await ctx.db.select({ patientId: signedConsents.patientId }).from(signedConsents).where(eq(signedConsents.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess({ db: ctx.db, session: ctx.session }, row.patientId, { consentOptional: true })
  const pdf = await readSignedPdf(ctx.db, row.patientId, id)
  if (!pdf) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('document.view', 'signed_consent', id, { kind: 'consent_pdf' })
  return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="signed-consent.pdf"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' } })
})
