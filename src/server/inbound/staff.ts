// Staff side of the email drop (FR-ING-04): the patient's drop address and the addresses verified in person.
// Route handlers wrap these in route() (staff: desk/records/clinician); the consent tab reads inboundEmailView().
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { caregivers, contactEmails, inboundAliases, patients, staff } from '@/db/schema'
import { decryptField, encryptField, hmac, randomToken } from '../crypto'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import type { StaffCtx } from '../registration/http'

export const inboundDomain = () => process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null
export const dropAddress = (token: string, domain: string) => `${token.toLowerCase()}@${domain}`

/** "ra•••@example.com": enough for staff to recognise an address they verified. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`
}

export type ContactEmailView = {
  id: string; emailMasked: string; caregiverId: string | null; verifiedBy: string; verifiedAt: Date; revoked: boolean
}

/** Must run inside withOrg after the access check. */
export async function inboundEmailView(tx: Tx, patientId: string) {
  const [alias] = await tx.select().from(inboundAliases).where(and(eq(inboundAliases.patientId, patientId), isNull(inboundAliases.revokedAt)))
  const rows = await tx.select().from(contactEmails).where(eq(contactEmails.patientId, patientId)).orderBy(desc(contactEmails.verifiedAt))
  const ids = [...new Set(rows.map((r) => r.verifiedBy))]
  const names = new Map((ids.length ? await tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, ids)) : []).map((s) => [s.id, s.name]))
  const domain = inboundDomain()
  return {
    domain,
    address: alias && domain ? dropAddress(alias.aliasToken, domain) : null,
    contacts: rows.map((r): ContactEmailView => ({
      id: r.id, emailMasked: maskEmail(decryptField(r.emailEnc)), caregiverId: r.caregiverId,
      verifiedBy: names.get(r.verifiedBy) ?? 'Staff', verifiedAt: r.verifiedAt, revoked: !!r.revokedAt,
    })),
  }
}

async function openPatient(ctx: StaffCtx<unknown>, patientId: string) {
  await assertPatientAccess(ctx, patientId)
  const [p] = await ctx.db.select({ deceased: patients.deceased, status: patients.status }).from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  if (p.deceased) throw new HttpError(409, 'deceased', 'This patient is recorded as deceased')
  if (p.status !== 'active') throw new HttpError(409, 'inactive', 'This record is closed')
}

/** Creates the drop address, or replaces it: the old address stops working at once. */
export async function rotateAlias(ctx: StaffCtx<unknown>, patientId: string) {
  const domain = inboundDomain()
  if (!domain) throw new HttpError(503, 'not_configured', 'Email drop is not set up on this server')
  await openPatient(ctx, patientId)
  const old = await ctx.db.update(inboundAliases).set({ revokedAt: new Date() })
    .where(and(eq(inboundAliases.patientId, patientId), isNull(inboundAliases.revokedAt))).returning({ id: inboundAliases.id })
  const aliasToken = randomToken(10, 'base32') // 80 bits, 16 characters
  const [row] = await ctx.db.insert(inboundAliases).values({ orgId: ctx.session.orgId, patientId, aliasToken, createdBy: ctx.session.staffId })
    .returning({ id: inboundAliases.id })
  await ctx.audit(old.length ? 'inbound.alias_rotated' : 'inbound.alias_created', 'patient', patientId, { aliasId: row.id, ...(old.length ? { revokedAliasId: old[0].id } : {}) })
  return { ok: true, address: dropAddress(aliasToken, domain) }
}

export const addContactEmailSchema = z.object({
  email: z.email().max(254),
  caregiverId: z.uuid().nullable().default(null),
  verifiedInPerson: z.literal(true),
})

/** Records an address the staff member checked in person with the patient or caregiver (there is no email round trip). */
export async function addContactEmail(ctx: StaffCtx<z.infer<typeof addContactEmailSchema>>, patientId: string) {
  await openPatient(ctx, patientId)
  const { body, db: tx } = ctx
  if (body.caregiverId) {
    const [c] = await tx.select({ active: caregivers.active, revokedAt: caregivers.revokedAt }).from(caregivers)
      .where(and(eq(caregivers.id, body.caregiverId), eq(caregivers.patientId, patientId)))
    if (!c || !c.active || c.revokedAt) throw new HttpError(400, 'invalid_caregiver', 'Choose an active caregiver of this patient')
  }
  const email = body.email.trim().toLowerCase()
  const emailHmac = hmac(email)
  const [dup] = await tx.select({ id: contactEmails.id }).from(contactEmails)
    .where(and(eq(contactEmails.patientId, patientId), eq(contactEmails.emailHmac, emailHmac), isNull(contactEmails.revokedAt)))
  if (dup) throw new HttpError(409, 'already_added', 'This address is already verified for this patient')
  const [row] = await tx.insert(contactEmails).values({
    orgId: ctx.session.orgId, patientId, caregiverId: body.caregiverId, emailEnc: encryptField(email), emailHmac, verifiedBy: ctx.session.staffId,
  }).returning({ id: contactEmails.id })
  await ctx.audit('inbound.contact_email_added', 'patient', patientId, { contactId: row.id, caregiverId: body.caregiverId })
  return { ok: true, contactId: row.id }
}

export async function revokeContactEmail(ctx: StaffCtx<unknown>, patientId: string, contactId: string) {
  await assertPatientAccess(ctx, patientId)
  const done = await ctx.db.update(contactEmails).set({ revokedAt: new Date() })
    .where(and(eq(contactEmails.id, contactId), eq(contactEmails.patientId, patientId), isNull(contactEmails.revokedAt))).returning({ id: contactEmails.id })
  if (!done.length) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('inbound.contact_email_revoked', 'patient', patientId, { contactId })
  return { ok: true }
}
