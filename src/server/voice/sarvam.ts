// Sarvam speech for pre-visit voice answers (PRD FR-VOX-03, FR-VOX-04, decision D4): speech-to-text with keyterm
// prompting (Saaras v4) and spoken read-back (Bulbul). Never log the audio or the text: both are patient data.
// API: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe and .../text-to-speech/convert
import type { Lang } from '@/core/types'

/** SARVAM_BASE_URL lets tests point at a local stub; production uses Sarvam's API. */
const base = () => (process.env.SARVAM_BASE_URL?.trim() || 'https://api.sarvam.ai').replace(/\/+$/, '')
export const sttUrl = () => `${base()}/speech-to-text`
export const ttsUrl = () => `${base()}/text-to-speech`
export const SARVAM_MODEL = 'saaras:v4' // keyterms work only on v4; v4 also accepts the output modes (checked live, 8 Nov 2026)
export const TTS_MODEL = 'bulbul:v3'
export const TTS_SPEAKER = 'priya'
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024 // well over 30 s of opus; the REST endpoint is for clips under 30 s
export const MAX_KEYTERMS = 50
export const MAX_KEYTERM_CHARS = 64
export const MAX_SPEAK_CHARS = 1500
const TIMEOUT_MS = 20_000

// Hindi keeps drug and hospital names in English letters (codemix); Hinglish comes back in Roman script (translit),
// as the Hinglish pages are written. Live check: v3 heard "Tab. Capecitabine" as "tap capacita bin"; v4 with keyterms
// returned "Tab Capecitabine".
export const STT_LANG: Record<Lang, { code: string; mode: string }> = {
  en: { code: 'en-IN', mode: 'transcribe' },
  hi: { code: 'hi-IN', mode: 'codemix' },
  hinglish: { code: 'hi-IN', mode: 'translit' },
}
const TTS_LANG: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'hi-IN' }

const EXT: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aiff': 'aiff',
}

export class SarvamError extends Error {
  constructor(readonly code: 'not_configured' | 'too_large' | 'failed', message: string) {
    super(message)
    this.name = 'SarvamError'
  }
}

const keyOrThrow = () => {
  const key = process.env.SARVAM_API_KEY
  if (!key) throw new SarvamError('not_configured', 'SARVAM_API_KEY is not set')
  return key
}

/**
 * Sarvam's keyterm rules: up to 50 terms, each at most 64 characters, one term per item, no duplicates. An item with a
 * comma or semicolon is refused with a 400 for the whole request (checked live: "City Care Hospital, Nagpur"), so such a
 * name becomes its parts.
 */
export function cleanKeyterms(terms: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms.flatMap((t) => t.split(/[,;]/))) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t || t.length > MAX_KEYTERM_CHARS || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === MAX_KEYTERMS) break
  }
  return out
}

/** Sends one recorded answer to Sarvam and returns the transcript (may be empty when nothing was heard). */
export async function transcribe(audio: Blob, lang: Lang, keyterms: readonly string[] = []): Promise<string> {
  const key = keyOrThrow()
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) throw new SarvamError('too_large', 'Audio must be between 1 byte and 2 MB')
  const type = audio.type.split(';')[0] || 'audio/webm' // drop ";codecs=opus"
  const form = new FormData()
  form.append('file', new Blob([audio], { type }), `answer.${EXT[type] ?? 'webm'}`)
  form.append('model', SARVAM_MODEL)
  form.append('language_code', STT_LANG[lang].code)
  form.append('mode', STT_LANG[lang].mode)
  const terms = cleanKeyterms(keyterms)
  if (terms.length) form.append('keyterms', JSON.stringify(terms))
  let res: Response
  try {
    res = await fetch(sttUrl(), { method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new SarvamError('failed', 'Sarvam did not answer in time')
  }
  if (!res.ok) throw new SarvamError('failed', `Sarvam answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as { transcript?: unknown } | null
  return typeof json?.transcript === 'string' ? json.transcript.trim() : ''
}

/** Spoken read-back: the text as a WAV file (FR-VOX-04). Callers decide whether speaking is allowed. */
export async function speak(text: string, lang: Lang): Promise<Uint8Array> {
  const key = keyOrThrow()
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > MAX_SPEAK_CHARS) throw new SarvamError('too_large', `Text must be between 1 and ${MAX_SPEAK_CHARS} characters`)
  let res: Response
  try {
    res = await fetch(ttsUrl(), {
      method: 'POST', headers: { 'api-subscription-key': key, 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
      // the docs name the field language_code; the API also reads target_language_code (both checked live)
      body: JSON.stringify({ text: t, language_code: TTS_LANG[lang], target_language_code: TTS_LANG[lang], model: TTS_MODEL, speaker: TTS_SPEAKER, speech_sample_rate: 22050 }),
    })
  } catch {
    throw new SarvamError('failed', 'Sarvam did not answer in time')
  }
  if (!res.ok) throw new SarvamError('failed', `Sarvam answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as { audios?: unknown } | null
  if (!Array.isArray(json?.audios) || !json.audios.length || !json.audios.every((a) => typeof a === 'string')) throw new SarvamError('failed', 'Sarvam returned no audio')
  return new Uint8Array(Buffer.from((json.audios as string[]).join(''), 'base64'))
}
