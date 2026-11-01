// Records requests (FR-REQ-01..03). GET: a patient's requests for staff (tracked lazily on read: state + reminders).
// POST: create a request letter from completeness items or manually — staff (records) or the patient/caregiver.
import { z } from 'zod'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { DEFAULT_REQUEST_DOCS, REQUEST_DOC_KEYS } from '@/server/requests/letter'
import { createRequest, listRequests } from '@/server/requests/requests'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')

export const GET = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], query: z.object({ patientId: z.uuid() }) }, async (ctx) => {
  await assertPatientAccess(ctx, ctx.query.patientId)
  return { requests: await listRequests(ctx.db, ctx.session.orgId, ctx.query.patientId, 'staff') }
})

const Body = z.object({
  patientId: z.uuid().optional(),
  missingIds: z.array(z.uuid()).max(20).default([]),
  institution: z.string().trim().min(2).max(200),
  institutionPatientId: z.string().trim().max(60).optional(),
  documents: z.array(z.enum(REQUEST_DOC_KEYS)).min(1).max(14).default(DEFAULT_REQUEST_DOCS),
  dateRange: z.object({ from: day.optional(), to: day.optional() }).optional(),
  lang: z.enum(['en', 'hi']).default('en'),
})

export const POST = route({ auth: 'any', body: Body }, async (ctx) => createRequest(ctx, ctx.body))
