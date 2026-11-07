// The patient or caregiver acknowledges the privacy notice. Stores the notice version and the time; audit-logged.
import { z } from 'zod'
import { route } from '@/server/http'
import { NOTICE_VERSION, recordAcknowledgement } from '@/server/privacy/privacy'

export const POST = route({
  auth: 'patient',
  body: z.object({ version: z.literal(NOTICE_VERSION), lang: z.enum(['en', 'hi', 'hinglish']).default('en') }),
}, async ({ session, db, body, audit }) => {
  const actor = { kind: session.kind, id: session.caregiverId ?? session.patientId }
  const { version } = await recordAcknowledgement(db, { orgId: session.orgId, patientId: session.patientId, actor, lang: body.lang })
  await audit('privacy.acknowledge', 'patient', session.patientId, { noticeVersion: version, actorKind: actor.kind })
  return { ok: true, version }
})
