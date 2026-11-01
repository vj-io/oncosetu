import { z } from 'zod'
import { route } from '@/server/http'
import { initialsView, searchPatients } from '@/server/registration/search'
import { resolveToken } from '@/server/registration/token'
import { initials } from '@/server/patients'
import { decryptField } from '@/server/crypto'
import { patients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { accession } from '@/server/registration/http'

// A scan or lookup IDENTIFIES only (FR-ID-02): initials and a code, never a name, DOB or phone. Every lookup is audited.
export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'],
  body: z.object({ mode: z.enum(['token', 'phone', 'mrn', 'name']), value: z.string().trim().min(1).max(120) }),
}, async (ctx) => {
  const { mode, value } = ctx.body
  if (mode === 'token') {
    const r = await resolveToken(ctx.db, ctx.session.orgId, value)
    await ctx.audit('desk.lookup', r.status === 'ok' ? 'patient' : null, r.status === 'ok' ? r.patientId : null, { mode, outcome: r.status })
    if (r.status !== 'ok') return { status: r.status, results: [] }
    const [p] = await ctx.db.select({ nameEnc: patients.nameEnc }).from(patients).where(eq(patients.id, r.patientId))
    return { status: 'ok', results: p ? [{ id: r.patientId, initials: initials(decryptField(p.nameEnc)), accession: accession(r.patientId) }] : [] }
  }
  const rows = await searchPatients(ctx.db, value, 10, mode)
  await ctx.audit('desk.lookup', null, null, { mode, outcome: rows.length ? 'found' : 'not_found', results: rows.length })
  return { status: rows.length ? 'ok' : 'not_found', results: rows.map(initialsView) }
})
