// Sarvam speech-to-text with fetch stubbed: the exact request (URL, auth header, model, language, mode), the 2 MB cap,
// upstream failures, and the missing-key case. No test sends real audio anywhere.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_AUDIO_BYTES, SARVAM_STT_URL, SarvamError, transcribe } from './sarvam'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Call = { url: string; init: RequestInit & { headers: Record<string, string>; body: FormData } }
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

describe('transcribe (Sarvam)', () => {
  it('posts multipart audio with the subscription key, saaras:v3 and the language code', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok(' Paracetamol 500 '))
    expect(await transcribe(audio(), 'en')).toBe('Paracetamol 500')
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(SARVAM_STT_URL)
    expect(url).toBe('https://api.sarvam.ai/speech-to-text')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'api-subscription-key': 'sk_test' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const f = init.body
    expect(f.get('model')).toBe('saaras:v3')
    expect(f.get('language_code')).toBe('en-IN')
    expect(f.get('mode')).toBe('transcribe')
    const file = f.get('file') as File
    expect(file.name).toBe('answer.webm')
    expect(file.type).toBe('audio/webm')
    expect(file.size).toBe(1000)
  })

  it('maps hi to hi-IN and hinglish to hi-IN in codemix mode', async () => {
    vi.stubEnv('SARVAM_API_KEY', 'sk_test')
    const calls = stubFetch(ok('x'))
    await transcribe(audio(10, 'audio/mp4'), 'hi')
    await transcribe(audio(10), 'hinglish')
    expect([calls[0].init.body.get('language_code'), calls[0].init.body.get('mode')]).toEqual(['hi-IN', 'transcribe'])
    expect((calls[0].init.body.get('file') as File).name).toBe('answer.m4a')
    expect([calls[1].init.body.get('language_code'), calls[1].init.body.get('mode')]).toEqual(['hi-IN', 'codemix'])
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
