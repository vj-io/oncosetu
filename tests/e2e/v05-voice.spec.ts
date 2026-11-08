// V05-E2E-08 and FR-VOX-03/05: voice answers and spoken read-back, against a local stand-in for Sarvam (no audio or text
// leaves the machine). Run the server AND the tests with the same two variables:
//   SARVAM_API_KEY=e2e-stub SARVAM_BASE_URL=http://127.0.0.1:4010
// The test turns the hospital's voice and spoken read-back flags on and back off, which every test in the org shares,
// so it runs alone with the clock tests (@clock).
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { orgSettings, voiceClips, type OrgFlags } from '../../src/db/schema'
import type { Answers } from '../../src/server/portal/visit-model'
import { portalLogin, registerPatient } from './helpers/api'
import { ORG } from './helpers/env'
import { statementsOf } from './helpers/db'
import { test, expect } from './helpers/fixtures'

const STUB = 'http://127.0.0.1:4010'
test.skip(process.env.SARVAM_BASE_URL !== STUB || !process.env.SARVAM_API_KEY, `needs SARVAM_BASE_URL=${STUB} and SARVAM_API_KEY on the server and the tests`)

type Seen = { path: string; key: string | undefined; body: Buffer; type: string | undefined }
const seen: Seen[] = []
const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')
let server: Server
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ path: req.url ?? '', key: req.headers['api-subscription-key'] as string | undefined, body: Buffer.concat(chunks), type: req.headers['content-type'] })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/speech-to-text') {
        // As Sarvam does (checked live): a keyterm with a comma or semicolon fails the whole request.
        const kt = /name="keyterms"\r\n\r\n(.*)\r\n/.exec(Buffer.concat(chunks).toString('latin1'))?.[1]
        if (kt && (JSON.parse(kt) as string[]).some((t) => /[,;]/.test(t))) { res.statusCode = 400; return res.end('{"error":{"code":"invalid_request_error"}}') }
        return res.end(JSON.stringify({ request_id: 'stub', transcript: 'Tab Capecitabine 500', language_code: 'en-IN' }))
      }
      if (req.url === '/text-to-speech') return res.end(JSON.stringify({ request_id: 'stub', audios: [WAV.toString('base64')] }))
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise<void>((ok) => server.listen(4010, '127.0.0.1', ok))
})
test.afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

const setFlags = (flags: OrgFlags) => adminDb.update(orgSettings).set({ flags }).where(eq(orgSettings.orgId, ORG))
const NO: Answers = {
  other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' }, anything_else: { yn: 'no' },
}

test('V05-E2E-08 spoken answers keep their recording; spoken read-back only when disclosure is cleared @clock', async ({ staff, ui }) => {
  test.setTimeout(300_000)
  const [{ flags: before }] = await adminDb.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ORG))
  const clinician = await staff('clinician'), desk = await staff('desk')
  const cleared = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const notCleared = await registerPatient(clinician, { base: 'returning', disclosure: 'not_cleared' })
  try {
    await setFlags({ ...before, voice: true, tts: true })
    const patient = await portalLogin(cleared.phone!)

    // An earlier answer names a hospital with a comma: it becomes keyterms, and Sarvam refuses an item with a comma.
    expect((await patient.post('/api/p/statements', { answers: { ...NO, other_hospital: { yn: 'yes', place: 'City Care Hospital, Nagpur' } }, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)

    // Voice typing: the audio goes to Sarvam with the formulary as keyterms; the recording is kept and its id returned.
    const audio = Buffer.from('synthetic-webm-bytes-for-e2e')
    const res = await patient.ctx.post('/api/p/voice/transcribe', { multipart: { lang: 'en', seconds: '3', audio: { name: 'answer.webm', mimeType: 'audio/webm', buffer: audio } } })
    expect(res.status()).toBe(200)
    const t = { body: (await res.json()) as { text: string; clipId: string } }
    expect(t.body.text).toBe('Tab Capecitabine 500')
    const stt = seen.filter((s) => s.path === '/speech-to-text').at(-1)!
    expect(stt.key).toBe(process.env.SARVAM_API_KEY)
    const sttBody = stt.body.toString('latin1')
    expect(sttBody).toContain('saaras:v4')
    expect(sttBody).toContain('"Capecitabine"') // keyterms JSON
    expect(sttBody).toContain('"City Care Hospital","Nagpur"') // split at the comma

    // The confirmed answer becomes a statement that names Sarvam and keeps the recording.
    const answers: Answers = { ...NO, new_medicines: { yn: 'yes', names: 'Tab Capecitabine 500', voice: true, clips: [t.body.clipId] } }
    expect((await patient.post('/api/p/statements', { answers, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)
    const st = (await statementsOf(cleared.id)).find((s) => s.audioId === t.body.clipId)!
    expect(st).toMatchObject({ asrProvider: 'sarvam', asrModel: 'saaras:v4', audioId: t.body.clipId, confirmation: 'confirmed' })

    // Staff with clinical roles can play it back (the same bytes, decrypted); the desk cannot.
    const played = await clinician.ctx.get(`/api/patients/${cleared.id}/statements/${st.id}/audio`)
    expect(played.status()).toBe(200)
    expect(played.headers()['content-type']).toBe('audio/webm')
    expect(Buffer.from(await played.body())).toEqual(audio)
    expect((await desk.get(`/api/patients/${cleared.id}/statements/${st.id}/audio`)).status).toBe(403)
    const page = await ui('clinician')
    await page.goto(`/patients/${cleared.id}/statements`)
    await expect(page.getByLabel("The patient's recording")).toHaveCount(1)

    // Spoken read-back: disclosure cleared and the flag on → WAV from Sarvam, built by the server from the answers.
    const ttsBefore = seen.filter((s) => s.path === '/text-to-speech').length
    const rb = await patient.ctx.post('/api/p/voice/readback', { data: { answers, lang: 'en' } })
    expect(rb.status()).toBe(200)
    expect(rb.headers()['content-type']).toBe('audio/wav')
    expect(Buffer.from(await rb.body())).toEqual(WAV)
    const tts = seen.filter((s) => s.path === '/text-to-speech')
    expect(tts).toHaveLength(ttsBefore + 1)
    expect(JSON.parse(tts.at(-1)!.body.toString())).toMatchObject({ model: 'bulbul:v3', language_code: 'en-IN', text: expect.stringContaining('Capecitabine') })

    // Disclosure not cleared → text only, and nothing is sent to Sarvam.
    const other = await portalLogin(notCleared.phone!)
    const refused = await other.post('/api/p/voice/readback', { answers: NO, lang: 'en' })
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'readback_text_only' } } })
    // The hospital turns spoken read-back off → text only for everyone.
    await setFlags({ ...before, voice: true, tts: false })
    expect((await patient.post('/api/p/voice/readback', { answers, lang: 'en' })).status).toBe(403)
    expect(seen.filter((s) => s.path === '/text-to-speech')).toHaveLength(ttsBefore + 1)
  } finally {
    await setFlags(before)
  }
})

test('FR-VOX-03 shadow mode: the recording is transcribed and kept for staff; what was heard never fills the answer @clock', async ({ staff, ui }) => {
  const [{ flags: before }] = await adminDb.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ORG))
  const clinician = await staff('clinician'), desk = await staff('desk')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const audio = Buffer.from('synthetic-shadow-webm-bytes')
  const record = (api: Awaited<ReturnType<typeof portalLogin>>) =>
    api.ctx.post('/api/p/voice/transcribe', { multipart: { lang: 'en', seconds: '4', audio: { name: 'answer.webm', mimeType: 'audio/webm', buffer: audio } } })
  try {
    const patient = await portalLogin(p.phone!)
    await setFlags({ ...before, voice: false, voice_shadow: false })
    expect((await record(patient)).status()).toBe(403) // neither voice nor shadow mode: nothing is sent

    await setFlags({ ...before, voice: false, voice_shadow: true })
    const sttBefore = seen.filter((s) => s.path === '/speech-to-text').length
    const res = await record(patient)
    expect(res.status()).toBe(200)
    const out = (await res.json()) as { clipId: string; shadow: string; text?: string }
    expect(seen.filter((s) => s.path === '/speech-to-text')).toHaveLength(sttBefore + 1) // it still went for transcription
    expect(out.text).toBeUndefined() // the browser never gets the words, so they cannot fill the answer
    expect(out.shadow).not.toContain('Capecitabine')

    // The patient types the answer; the sealed token rides beside it. A token this server did not seal is dropped.
    const typed = 'Capecitabine 500 mg twice a day'
    const answers: Answers = { ...NO, new_medicines: { yn: 'yes', names: typed, shadow: [out.shadow, 'v1.forged'] } }
    expect((await patient.post('/api/p/statements', { answers, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)
    const st = (await statementsOf(p.id)).find((s) => s.questionId === 'new_medicines')!
    expect(st).toMatchObject({ transcript: typed, asrProvider: null, audioId: null })
    expect((st.answer as { asrShadow?: string[] }).asrShadow).toEqual([out.shadow])
    expect(JSON.stringify(st.answer)).not.toContain('Tab Capecitabine 500')
    const [clip] = await adminDb.select({ statementId: voiceClips.statementId }).from(voiceClips).where(eq(voiceClips.id, out.clipId))
    expect(clip.statementId).toBe(st.id)

    // Staff see the trial beside the typed words and can play it; the desk cannot.
    const page = await ui('clinician')
    await page.goto(`/patients/${p.id}/statements`)
    const trial = page.getByTestId('voice-shadow')
    await expect(trial).toHaveCount(1)
    await expect(trial).toContainText('Tab Capecitabine 500') // what the speech service heard (the stub)
    await expect(page.locator('blockquote', { hasText: typed })).toHaveCount(1) // the answer is what was typed
    const played = await clinician.ctx.get(`/api/patients/${p.id}/statements/${st.id}/audio?clip=${out.clipId}`)
    expect(played.status()).toBe(200)
    expect(Buffer.from(await played.body())).toEqual(audio)
    expect((await desk.get(`/api/patients/${p.id}/statements/${st.id}/audio?clip=${out.clipId}`)).status).toBe(403)
    expect((await clinician.get(`/api/patients/${p.id}/statements/${st.id}/audio?clip=00000000-0000-7000-8000-000000000000`)).status).toBe(404)
  } finally {
    await setFlags(before)
  }
})
