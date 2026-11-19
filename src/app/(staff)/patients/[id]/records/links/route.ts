import { NextResponse } from 'next/server'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { decideLink, linkDecisionSchema } from '@/server/records/queries'
import { patientIdParam } from '@/server/registration/http'

/**
 * A person confirms that a scan and a written report belong together, or says they do not (this is also how a confirmed pair
 * is unlinked). The system only proposes pairs, from dates and header words; it never links silently. Audited with ids only.
 */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: linkDecisionSchema }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const r = await decideLink(ctx.db, patientId, ctx.session.staffId, ctx.body)
  await ctx.audit(`document_link.${r.state}`, 'document_link', r.id, { scanId: ctx.body.scanId, reportId: ctx.body.reportId, from: r.from })
  return NextResponse.json({ ok: true, state: r.state })
})
