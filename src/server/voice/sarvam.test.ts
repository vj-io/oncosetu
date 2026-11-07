// Sarvam speech with fetch stubbed: the exact requests (URL, auth header, model, language, mode, keyterms, voice),
// the size caps, upstream failures, and the missing-key case. No test sends real audio or text anywhere.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_AUDIO_BYTES, MAX_KEYTERMS, MAX_SPEAK_CHARS, SarvamError, cleanKeyterms, speak, sttUrl, transcribe, ttsUrl } from './sarvam'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Call = { url: string; init: RequestInit & { headers: Record<string, string>; body: FormData | string } }
function stubFetch(res: Response | Error) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: Call['init']) => {
    calls.push({ url: String(url), init })
    if (res instanceof Error) throw res
    return res.clone()
  }))
  return calls
}
const ok = (transcript: string) => new Response(JSON.stringify({ request_id: 'r1', transcript, language_code: 'hi-IN' }), { status: 200 })
const audio = (bytes = 1000, type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array(bytes)], { type })
const form = (c: Call) => c.init.body as FormData

describe('transcribe (Sarvam)', () => {
  it('posts multipart audio with the subscription key, saaras:v4 and the language code', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok(' Paracetamol 500 '))
    expect(await transcribe(audio(), 'en')).toBe('Paracetamol 500')
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('https://api.sarvam.ai/speech-to-text')
    expect(url).toBe(sttUrl())
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'api-subscription-key': 'sk_test' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const f = form(calls[0])
    expect(f.get('model')).toBe('saaras:v4')
    expect(f.get('language_code')).toBe('en-IN')
    expect(f.get('mode')).toBe('transcribe')
    expect(f.get('keyterms')).toBeNull()
    const file = f.get('file') as File
    expect(file.name).toBe('answer.webm')
    expect(file.type).toBe('audio/webm')
    expect(file.size).toBe(1000)
  })

  it('maps hi to hi-IN codemix and hinglish to hi-IN translit', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok('x'))
    await transcribe(audio(10, 'audio/mp4'), 'hi')
    await transcribe(audio(10), 'hinglish')
    expect([form(calls[0]).get('language_code'), form(calls[0]).get('mode')]).toEqual(['hi-IN', 'codemix'])
    expect((form(calls[0]).get('file') as File).name).toBe('answer.m4a')
    expect([form(calls[1]).get('language_code'), form(calls[1]).get('mode')]).toEqual(['hi-IN', 'translit'])
  })

  it('sends the patient’s own drug names as keyterms, cleaned to Sarvam’s limits', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok('Tab Capecitabine'))
    await transcribe(audio(), 'hinglish', ['Capecitabine', ' capecitabine ', '', 'x'.repeat(65), 'Ondansetron'])
    expect(JSON.parse(String(form(calls[0]).get('keyterms')))).toEqual(['Capecitabine', 'Ondansetron'])
  })

  it('honours SARVAM_BASE_URL so tests can point at a local stub', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    vi.stubEnv('SARVAM_BASE_URL', 'http://127.0.0.1:4010/')
    const calls = stubFetch(ok('x'))
    await transcribe(audio(), 'en')
    expect(calls[0].url).toBe('http://127.0.0.1:4010/speech-to-text')
    expect(ttsUrl()).toBe('http://127.0.0.1:4010/text-to-speech')
  })

  it('refuses audio over 2 MB (and empty audio) without calling Sarvam', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok('x'))
    await expect(transcribe(audio(MAX_AUDIO_BYTES + 1), 'en')).rejects.toMatchObject({ code: 'too_large' })
    await expect(transcribe(audio(0), 'en')).rejects.toMatchObject({ code: 'too_large' })
    expect(await transcribe(audio(MAX_AUDIO_BYTES), 'en')).toBe('x')
    expect(calls).toHaveLength(1)
  })

  it('turns a non-200 answer or a timeout into a failure that carries no transcript', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    stubFetch(new Response(JSON.stringify({ error: { message: 'bad key', code: 'invalid_api_key_error' } }), { status: 403 }))
    const err = await transcribe(audio(), 'en').catch((e) => e)
    expect(err).toBeInstanceOf(SarvamError)
    expect(err).toMatchObject({ code: 'failed', message: 'Sarvam answered 403' })
    stubFetch(new DOMException('timed out', 'TimeoutError'))
    await expect(transcribe(audio(), 'en')).rejects.toMatchObject({ code: 'failed' })
  })

  it('is not configured without SARVAM_API_KEY and makes no call', async () => {
    vi.stubEnv('SARVAM_API_KEY', '')
    const calls = stubFetch(ok('x'))
    await expect(transcribe(audio(), 'en')).rejects.toMatchObject({ code: 'not_configured' })
    expect(calls).toHaveLength(0)
  })
})

describe('cleanKeyterms', () => {
  it('trims, drops blanks, over-long and duplicate terms, and stops at 50', () => {
    expect(cleanKeyterms(['  Tab  Capecitabine ', 'TAB CAPECITABINE', '', 'y'.repeat(64)])).toEqual(['Tab Capecitabine', 'y'.repeat(64)])
    expect(cleanKeyterms(Array.from({ length: 80 }, (_, i) => `drug${i}`))).toHaveLength(MAX_KEYTERMS)
  })

  it('splits a name with a comma or semicolon into its parts (Sarvam refuses the whole request otherwise)', () => {
    expect(cleanKeyterms(['City Care Hospital, Nagpur', 'Tata Memorial; Mumbai', 'Nagpur'])).toEqual(['City Care Hospital', 'Nagpur', 'Tata Memorial', 'Mumbai'])
  })
})

describe('speak (Sarvam Bulbul)', () => {
  const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3])
  const audios = (parts: string[]) => new Response(JSON.stringify({ request_id: 'r2', audios: parts }), { status: 200 })

  it('posts JSON text with the language, bulbul:v3 and the speaker, and decodes the WAV', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(audios([Buffer.from(wav).toString('base64')]))
    expect(await speak('  Aapne kaha:\n Capecitabine  ', 'hinglish')).toEqual(wav)
    const { url, init } = calls[0]
    expect(url).toBe('https://api.sarvam.ai/text-to-speech')
    expect(init.headers).toEqual({ 'api-subscription-key': 'sk_test', 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'Aapne kaha: Capecitabine', language_code: 'hi-IN', target_language_code: 'hi-IN',
      model: 'bulbul:v3', speaker: 'priya', speech_sample_rate: 22050,
    })
  })

  it('refuses empty or over-long text without calling Sarvam', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(audios(['AA==']))
    await expect(speak('   ', 'en')).rejects.toMatchObject({ code: 'too_large' })
    await expect(speak('a'.repeat(MAX_SPEAK_CHARS + 1), 'en')).rejects.toMatchObject({ code: 'too_large' })
    expect(calls).toHaveLength(0)
  })

  it('fails on a non-200 answer or a reply without audio', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    stubFetch(new Response('{}', { status: 429 }))
    await expect(speak('hello', 'en')).rejects.toMatchObject({ code: 'failed', message: 'Sarvam answered 429' })
    stubFetch(audios([]))
    await expect(speak('hello', 'en')).rejects.toMatchObject({ code: 'failed', message: 'Sarvam returned no audio' })
  })

  it('is not configured without SARVAM_API_KEY', async () => {
    vi.stubEnv('SARVAM_API_KEY', '')
    const calls = stubFetch(audios(['AA==']))
    await expect(speak('hello', 'en')).rejects.toMatchObject({ code: 'not_configured' })
    expect(calls).toHaveLength(0)
  })
})
