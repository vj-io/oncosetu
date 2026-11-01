import { z } from 'zod'
import { route } from '@/server/http'
import { consentedView, initialsView, searchPatients } from '@/server/registration/search'
import { registerPatient } from '@/server/registration/register'
import { registerSchema } from '@/server/registration/schemas'

const FRONT = ['desk', 'records', 'clinician'] as const

/** Register a patient: identity, contacts, disclosure, consent (OTP or witnessed), QR token. Returns the token once. */
export const POST = route({ auth: 'staff', roles: FRONT, body: registerSchema }, (ctx) => registerPatient(ctx))

/** Search the organisation's patients. The desk sees initials only (FR-ID-02); records and clinicians see the register. */
export const GET = route({ auth: 'staff', roles: FRONT, query: z.object({ q: z.string().max(80).default('') }) }, async (ctx) => {
  const rows = await searchPatients(ctx.db, ctx.query.q)
  await ctx.audit('patient.search', null, null, { results: rows.length, role: ctx.session.role })
  if (ctx.session.role === 'desk') return { patients: rows.map(initialsView) }
  return { patients: rows.map(consentedView).map(({ createdAt, ...r }) => ({ ...r, createdAt: createdAt.toISOString() })) }
})
