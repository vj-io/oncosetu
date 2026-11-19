// The signed-in patient's / caregiver's own requests, tracked lazily on read (neutral labels unless cleared).
import { z } from 'zod'
import { route } from '@/server/http'
import { createPatientLetter } from '@/server/requests/patient-letter'
import { listRequests } from '@/server/requests/requests'

export const GET = route({ auth: 'patient' }, async (ctx) =>
  ({ requests: await listRequests(ctx.db, ctx.session.orgId, ctx.session.patientId, 'patient') }))

// A family makes the letter for one missing paper (finale decision 1). WP1's "Get a letter" button calls this.
// Body {missingId, lang: 'en' | 'hi'} → {requestId, printUrl}. Own patient only; the letter is the staff letter.
const LetterBody = z.object({ missingId: z.uuid(), lang: z.enum(['en', 'hi']).default('en') })

export const POST = route({ auth: 'patient', body: LetterBody }, async (ctx) => {
  const { requestId, printUrl } = await createPatientLetter(ctx, ctx.body)
  return { requestId, printUrl }
})
