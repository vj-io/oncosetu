// Spoken read-back of pre-visit answers (FR-VOX-04): only when the hospital has spoken read-back on and the patient's
// diagnosis disclosure is cleared (FR-CON-07); otherwise text read-back only. The server rebuilds the read-back from the
// answers, so this route never speaks arbitrary text. Nothing is stored; never log the text.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { orgSettings, patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { answersSchema, buildReadback } from '@/server/portal/visit-model'
import { SarvamError, speak } from '@/server/voice/sarvam'

export const POST = route({
  auth: 'patient',
  body: z.object({ answers: answersSchema, lang: z.enum(['en', 'hi', 'hinglish']) }),
}, async (ctx) => {
  if (!process.env.SARVAM_API_KEY) throw new HttpError(503, 'voice_not_configured', 'Spoken read-back is not set up on this server')
  const [s] = await ctx.db.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ctx.session.orgId))
  const [p] = await ctx.db.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, ctx.session.patientId))
  if (!s?.flags?.tts || p?.disclosure !== 'cleared') throw new HttpError(403, 'readback_text_only', 'Read-back is shown as text for this record')
  const rb = buildReadback(ctx.body.answers, ctx.body.lang)
  const text = [rb.intro, ...rb.lines.map((l) => l.text)].join(' ')
  let wav: Uint8Array
  try {
    wav = await speak(text, ctx.body.lang)
  } catch (e) {
    if (!(e instanceof SarvamError)) throw e
    if (e.code === 'too_large') throw new HttpError(413, 'too_large', 'The read-back is too long to speak')
    ctx.log.warn('voice.readback_failed', { provider: 'sarvam', reason: e.message })
    throw new HttpError(502, 'voice_failed', 'Spoken read-back did not work')
  }
  await ctx.audit('voice.readback', 'patient', ctx.session.patientId, { provider: 'sarvam', chars: text.length })
  return new Response(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})
