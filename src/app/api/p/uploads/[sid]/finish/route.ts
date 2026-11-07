import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { finishUpload } from '@/server/uploads/finish'

/** Patient: all chunks are in. Nothing about the content comes back (FR-CON-07): only counts and what was skipped. */
export const POST = route({ auth: 'patient' }, async (ctx) =>
  finishUpload({
    db: ctx.db, orgId: ctx.session.orgId, patientId: ctx.session.patientId, uploader: { kind: ctx.session.kind, id: ctx.session.caregiverId ?? ctx.session.patientId },
    sessionId: patientIdParam(ctx, 'sid'), audit: ctx.audit,
  }))
