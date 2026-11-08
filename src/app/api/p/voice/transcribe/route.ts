// Voice typing for pre-visit answers (FR-VOX-03, FR-VOX-05): audio in, text out. The recording is kept, encrypted, so it
// can sit beside the statement it becomes; the person reads the text back and the statements route stores what they
// confirm. Keyterms (their own medicines and hospitals, then the formulary) help Sarvam spell drug names. Never log
// the audio or the text.
// Shadow mode (org flag voice_shadow, FR-VOX-03): the same recording and transcription, but the text goes back sealed
// (sealShadow) so it cannot fill the answer; the statement keeps it for staff to compare with what the patient typed.
import { eq } from 'drizzle-orm'
import { orgSettings } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { storeClip } from '@/server/voice/clips'
import { sealShadow } from '@/server/portal/statements'
import { keytermsFor } from '@/server/voice/keyterms'
import { asr } from '@/server/voice/provider'
import { SarvamError } from '@/server/voice/sarvam'

const LANGS = ['en', 'hi', 'hinglish'] as const

export const POST = route({ auth: 'patient', form: true, maxBytes: 2.2 * 1024 * 1024 }, async (ctx) => {
  if (!process.env.SARVAM_API_KEY) throw new HttpError(503, 'voice_not_configured', 'Voice typing is not set up on this server')
  const audio = ctx.form.get('audio'), lang = LANGS.find((l) => l === ctx.form.get('lang'))
  if (!(audio instanceof Blob) || !lang) throw new HttpError(400, 'invalid_request', 'Audio and a language are required')
  const [s] = await ctx.db.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ctx.session.orgId))
  if (!s?.flags?.voice && !s?.flags?.voice_shadow) throw new HttpError(403, 'voice_off', 'Voice typing is off for this hospital')
  const shadow = !!s.flags.voice_shadow
  const keyterms = await keytermsFor(ctx.db, ctx.session.patientId)
  let text: string
  try {
    text = await asr.transcribe(audio, lang, keyterms)
  } catch (e) {
    if (!(e instanceof SarvamError)) throw e
    if (e.code === 'too_large') throw new HttpError(413, 'too_large', 'Recording is too long')
    if (e.code === 'not_configured') throw new HttpError(503, 'voice_not_configured', 'Voice typing is not set up on this server')
    ctx.log.warn('voice.transcribe_failed', { provider: asr.name, reason: e.message })
    throw new HttpError(502, 'voice_failed', 'Voice typing did not work')
  }
  const seconds = Math.min(60, Math.max(0, Math.round(Number(ctx.form.get('seconds')) || 0)))
  const clipId = await storeClip(ctx.db, {
    orgId: ctx.session.orgId, patientId: ctx.session.patientId, bytes: new Uint8Array(await audio.arrayBuffer()), mime: audio.type, seconds,
    by: { kind: ctx.session.kind, id: ctx.session.caregiverId ?? ctx.session.patientId },
  })
  await ctx.audit('voice.transcribed', 'patient', ctx.session.patientId, { provider: asr.name, model: asr.model, seconds, keyterms: keyterms.length, clipId, shadow })
  return shadow ? { clipId, shadow: sealShadow({ clipId, patientId: ctx.session.patientId, text }) } : { text, clipId }
})
