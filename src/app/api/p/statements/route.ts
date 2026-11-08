// Pre-visit answers (FR-VOX-01..07). The server rebuilds the read-back text itself; the client only says how it was confirmed.
// The org decides which questions are asked (FR-VOX-01): each one it asks, but anything else, needs an answer; answers to a
// question it does not ask are dropped.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { orgSettings } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { assertConsent } from '@/server/patients'
import { recomputeRadar } from '@/server/portal/pipeline'
import { saveVisit } from '@/server/portal/statements'
import { answersFor, enabledQuestions, missingQuestion, type Answers } from '@/server/portal/visit-model'

export const POST = route({
  auth: 'patient',
  body: z.object({
    answers: answersFor([]),
    lang: z.enum(['en', 'hi', 'hinglish']),
    confirmation: z.enum(['confirmed', 'corrected', 'unconfirmed']),
  }),
}, async ({ session, db, body, audit }) => {
  await assertConsent(db, session.patientId, 'store')
  const [s] = await db.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, session.orgId))
  const asked = enabledQuestions(s?.flags?.questions)
  const missing = missingQuestion(body.answers, asked)
  if (missing) throw new HttpError(400, 'answer_required', `An answer is required for ${missing}`)
  const answers: Answers = Object.fromEntries(asked.filter((q) => body.answers[q]).map((q) => [q, body.answers[q]]))
  const saved = await saveVisit(db, {
    orgId: session.orgId, patientId: session.patientId, lang: body.lang,
    actor: { kind: session.kind, id: session.caregiverId ?? session.patientId },
  }, answers, body.confirmation)
  await recomputeRadar(db, session.orgId, session.patientId) // so RAD-IMG-PT-01 / RAD-RX-OUT-01 can fire
  await audit('statements.submit', 'patient', session.patientId, {
    batchId: saved.batchId, statements: saved.statements, events: saved.events, confirmation: body.confirmation,
    voice: Object.values(answers).some((a) => a?.voice), shadowClips: saved.shadowClips,
  })
  return { ok: true, confirmed: body.confirmation !== 'unconfirmed' }
})
