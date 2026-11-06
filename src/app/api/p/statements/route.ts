// Pre-visit answers (FR-VOX-01..07). The server rebuilds the read-back text itself; the client only says how it was confirmed.
import { z } from 'zod'
import { assertConsent } from '@/server/patients'
import { route } from '@/server/http'
import { recomputeRadar } from '@/server/portal/pipeline'
import { saveVisit } from '@/server/portal/statements'
import { answersSchema } from '@/server/portal/visit-model'

export const POST = route({
  auth: 'patient',
  body: z.object({
    answers: answersSchema,
    lang: z.enum(['en', 'hi', 'hinglish']),
    confirmation: z.enum(['confirmed', 'corrected', 'unconfirmed']),
  }),
}, async ({ session, db, body, audit }) => {
  await assertConsent(db, session.patientId, 'store')
  const saved = await saveVisit(db, {
    orgId: session.orgId, patientId: session.patientId, lang: body.lang,
    actor: { kind: session.kind, id: session.caregiverId ?? session.patientId },
  }, body.answers, body.confirmation)
  await recomputeRadar(db, session.orgId, session.patientId) // so RAD-IMG-PT-01 / RAD-RX-OUT-01 can fire
  await audit('statements.submit', 'patient', session.patientId, {
    batchId: saved.batchId, statements: saved.statements, events: saved.events, confirmation: body.confirmation,
    voice: Object.values(body.answers).some((a) => a?.voice),
  })
  return { ok: true, confirmed: body.confirmation !== 'unconfirmed' }
})
