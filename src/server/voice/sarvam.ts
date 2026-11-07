// Sarvam speech-to-text for pre-visit voice answers (PRD FR-VOX-03, decision D4).
// API: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe (REST, clips under 30 s).
// Never log the audio or the transcript: both are patient data.
import type { Lang } from '@/core/types'

export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text'
export const SARVAM_MODEL = 'saaras:v3' // `mode` (codemix) is documented for saaras:v3 only
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024 // well over 30 s of opus; the REST endpoint is for clips under 30 s
const TIMEOUT_MS = 20_000

// Hinglish: Hindi with English words kept in English (codemix mode).
const LANG: Record<Lang, { code: string; mode: string }> = {
  en: { code: 'en-IN', mode: 'transcribe' },
  hi: { code: 'hi-IN', mode: 'transcribe' },
  hinglish: { code: 'hi-IN', mode: 'codemix' },
}

const EXT: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aiff': 'aiff',
}

export class SarvamError extends Error {
  constructor(readonly code: 'not_configured' | 'too_large' | 'failed', message: string) {
    super(message)
    this.name = 'SarvamError'
  }
}

/** Sends one recorded answer to Sarvam and returns the transcript (may be empty when nothing was heard). */
export async function transcribe(audio: Blob, lang: Lang): Promise<string> {
  const key = process.env.SARVAM_API_KEY
  if (!key) throw new SarvamError('not_configured', 'SARVAM_API_KEY is not set')
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) throw new SarvamError('too_large', 'Audio must be between 1 byte and 2 MB')
  const type = audio.type.split(';')[0] || 'audio/webm' // drop ";codecs=opus"
  const form = new FormData()
  form.append('file', new Blob([audio], { type }), `answer.${EXT[type] ?? 'webm'}`)
  form.append('model', SARVAM_MODEL)
  form.append('language_code', LANG[lang].code)
  form.append('mode', LANG[lang].mode)
  let res: Response
  try {
    res = await fetch(SARVAM_STT_URL, {
      method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new SarvamError('failed', 'Sarvam did not answer in time')
  }
  if (!res.ok) throw new SarvamError('failed', `Sarvam answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as { transcript?: unknown } | null
  return typeof json?.transcript === 'string' ? json.transcript.trim() : ''
}
