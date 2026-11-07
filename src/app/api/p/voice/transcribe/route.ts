// Voice typing for pre-visit answers (FR-VOX-03): audio in, text out. Nothing is stored here; the person reads the
// text back and the statements route stores what they confirm. Never log the audio or the text.
import { eq } from 'drizzle-orm'
import { orgSettings } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { SarvamError, transcribe } from '@/server/voice/sarvam'

const LANGS = ['en', 'hi', 'hinglish'] as const

export const POST = route({ auth: 'patient', form: true, maxBytes: 2.2 * 1024 * 1024 }, async (ctx) => {
  if (!process.env.SARVAM_API_KEY) throw new HttpError(503, 'voice_not_configured', 'Voice typing is not set up on this server')
  const audio = ctx.form.get('audio'), lang = LANGS.find((l) => l === ctx.form.get('lang'))
  if (!(audio instanceof Blob) || !lang) throw new HttpError(400, 'invalid_request', 'Audio and a language are required')
  const [s] = await ctx.db.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ctx.session.orgId))
  if (!s?.flags?.voice) throw new HttpError(403, 'voice_off', 'Voice typing is off for this hospital')
  let text: string
  try {
    text = await transcribe(audio, lang)
  } catch (e) {
    if (!(e instanceof SarvamError)) throw e
    if (e.code === 'too_large') throw new HttpError(413, 'too_large', 'Recording is too long')
    if (e.code === 'not_configured') throw new HttpError(503, 'voice_not_configured', 'Voice typing is not set up on this server')
    ctx.log.warn('voice.transcribe_failed', { provider: 'sarvam', reason: e.message })
    throw new HttpError(502, 'voice_failed', 'Voice typing did not work')
  }
  const seconds = Math.min(60, Math.max(0, Math.round(Number(ctx.form.get('seconds')) || 0)))
  await ctx.audit('voice.transcribed', 'patient', ctx.session.patientId, { provider: 'sarvam', seconds })
  return { text }
})
