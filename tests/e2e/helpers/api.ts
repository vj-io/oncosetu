// A signed-in API client for one role (cookie session from the real login route), plus the flows tests repeat:
// register a synthetic patient, upload a demo document, wait for the pipeline, read the simulated SMS.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { request, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test'
import { CONSENT_NOTICE_VERSION } from '../../../src/i18n/consent'
import { smsTo } from './db'
import { BASE, EMAIL, PASSWORD, type RoleKey } from './env'
import { totpFor } from './totp'

export type Reply<T = any> = { status: number; ok: boolean; body: T }

async function reply<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<Reply<T>> {
  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* not JSON (CSV, PDF, HTML) */ }
  return { status: res.status(), ok: res.ok(), body: body as T }
}

const ORIGIN = { Origin: BASE }

/** No session: public routes and "who is not allowed" checks. */
export const anonymous = () => request.newContext({ baseURL: BASE, extraHTTPHeaders: ORIGIN, timeout: 90_000 })

export class Api {
  private constructor(readonly ctx: APIRequestContext, readonly email: string) {}

  static wrap = (ctx: APIRequestContext, label: string) => new Api(ctx, label)

  static async login(role: RoleKey | { email: string; password?: string }): Promise<Api> {
    const email = typeof role === 'string' ? EMAIL[role] : role.email
    const password = typeof role === 'string' ? PASSWORD : role.password ?? PASSWORD
    const ctx = await anonymous()
    const r = await reply(await ctx.post('/api/auth/staff/login', { data: { email, password, totp: totpFor(email) } }))
    if (!r.ok) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`)
    return new Api(ctx, email)
  }

  get = async <T = any>(path: string) => reply<T>(await this.ctx.get(path))
  post = async <T = any>(path: string, data: unknown = {}) => reply<T>(await this.ctx.post(path, { data }))
  upload = async <T = any>(path: string, file: { name: string; buffer: Buffer; mimeType?: string }, fields: Record<string, string> = {}) =>
    reply<T>(await this.ctx.post(path, { multipart: { ...fields, file: { name: file.name, mimeType: file.mimeType ?? 'application/octet-stream', buffer: file.buffer } } }))

  /** A browser context carrying this session's cookie, for UI assertions. */
  browserContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
    return this.ctx.storageState().then((storageState) => browser.newContext({ storageState, baseURL: BASE, ...options }))
  }
  dispose = () => this.ctx.dispose()
}

/** Patient or caregiver session through the real phone-OTP flow (the code is read from the simulated SMS). */
export async function portalLogin(phone: string): Promise<Api> {
  const ctx = await anonymous()
  const since = Date.now() - 2000
  await reply(await ctx.post('/api/auth/patient/otp/start', { data: { phone } }))
  const code = await waitForCode(phone, since)
  const r = await reply(await ctx.post('/api/auth/patient/otp/verify', { data: { phone, code } }))
  if (!r.ok) throw new Error(`portal login failed: ${r.status} ${JSON.stringify(r.body)}`)
  return Api.wrap(ctx, phone)
}

export async function waitForSms(phone: string, since: number, match: (s: { body: string; templateKey: string }) => boolean = () => true, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const hit = (await smsTo(phone)).find((m) => m.createdAt.getTime() >= since && match(m))
    if (hit) return hit
    if (Date.now() > end) throw new Error(`no SMS to ${phone} within ${timeoutMs} ms`)
    await new Promise((r) => setTimeout(r, 400))
  }
}
export async function waitForCode(phone: string, since: number) {
  const m = await waitForSms(phone, since, (s) => /\d{6}/.test(s.body))
  return m.body.match(/\b(\d{6})\b/)![1]
}

// ── patients ─────────────────────────────────────────────────────────────────
export type DemoKey = 'hero' | 'returning' | 'fulfilled'
type DemoPatient = {
  patientKey: DemoKey; fullName: string; aliases: string[]; sex: 'female' | 'male'; dob: string; phone: string; preferredLanguage: 'en' | 'hi'
  caregiver: { name: string; relation: string; phone: string } | null; disclosureStatus: 'cleared' | 'not_cleared' | 'unknown'; primaryContact: 'patient' | 'caregiver'
}
const DEMO_DOCS = join(process.cwd(), 'public/demo-docs')
export const demoPatient = (k: DemoKey): DemoPatient =>
  (JSON.parse(readFileSync(join(DEMO_DOCS, 'patients.json'), 'utf8')) as DemoPatient[]).find((p) => p.patientKey === k)!

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
/** A phone number nobody else uses: portal login resolves a phone across all organisations, so each patient needs its own. */
export const freshPhone = () => `+91 9${digits(4)} ${digits(5)}`

export type Registered = {
  id: string; token: string; accession: string; name: string; phone: string | null; caregiverPhone: string | null
  disclosure: 'cleared' | 'not_cleared' | 'unknown'; primaryContact: 'patient' | 'caregiver'
}
export type RegisterOpts = {
  base?: DemoKey
  fullName?: string; dob?: string; sex?: 'female' | 'male' | 'other' | 'unknown'; preferredLanguage?: 'en' | 'hi'
  aliases?: boolean
  disclosure?: 'cleared' | 'not_cleared' | 'unknown'
  primaryContact?: 'patient' | 'caregiver'
  withCaregiver?: boolean
  phone?: string | null
  purposes?: { store: boolean; ai: boolean; share: boolean; abdm: boolean; metrics: boolean }
  confirm?: 'witnessed' | 'otp'
  continueDespiteDuplicates?: boolean
}
export const ALL_PURPOSES = { store: true, ai: true, share: true, abdm: false, metrics: true }

/** Registers a synthetic patient in Ganga with the demo patient's identity (names must match the documents' headers). */
export async function registerPatient(api: Api, o: RegisterOpts = {}): Promise<Registered> {
  const d = demoPatient(o.base ?? 'hero')
  const primaryContact = o.primaryContact ?? d.primaryContact
  const disclosure = o.disclosure ?? 'unknown'
  const phone = o.phone === null ? null : o.phone ?? freshPhone()
  const wantsCaregiver = o.withCaregiver ?? (primaryContact === 'caregiver' || !!d.caregiver)
  const caregiver = wantsCaregiver ? { name: d.caregiver?.name ?? 'Test Caregiver', relation: d.caregiver?.relation ?? 'son', phone: freshPhone(), isGuardian: false } : undefined
  const purposes = o.purposes ?? ALL_PURPOSES
  const language = o.preferredLanguage ?? d.preferredLanguage
  let confirm: unknown = { method: 'witnessed', attest: true }
  if (o.confirm === 'otp') {
    const target = primaryContact === 'caregiver' ? caregiver!.phone : phone!
    const since = Date.now() - 2000
    const sent = await api.post('/api/desk/consent-otp', { phone: target, language })
    if (!sent.ok) throw new Error(`consent otp failed: ${JSON.stringify(sent.body)}`)
    confirm = { method: 'otp', code: await waitForCode(target, since) }
  }
  const body = {
    fullName: o.fullName ?? d.fullName,
    aliases: o.aliases === false ? [] : d.aliases.filter((a) => a !== d.fullName).map((name) => ({ name, kind: 'transliteration' })),
    dob: o.dob ?? d.dob, sex: o.sex ?? d.sex, ...(phone ? { phone } : {}), preferredLanguage: language,
    disclosureStatus: disclosure, primaryContact, ...(caregiver ? { caregiver } : {}),
    consent: { purposes, language, noticeVersion: CONSENT_NOTICE_VERSION, confirm },
    continueDespiteDuplicates: o.continueDespiteDuplicates ?? true,
  }
  const r = await api.post('/api/patients', body)
  if (!r.ok) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { id: r.body.id, token: r.body.token, accession: r.body.accession, name: body.fullName, phone, caregiverPhone: caregiver?.phone ?? null, disclosure, primaryContact }
}

// ── documents ────────────────────────────────────────────────────────────────
export const demoDoc = (file: string) => ({ name: file, buffer: readFileSync(join(DEMO_DOCS, file)) })
const SETTLED = new Set(['done', 'needs_review', 'failed', 'unreadable', 'quarantined', 'needs_password'])

export type Uploaded = { documentId: string; status: string; duplicateOf?: string; nearDuplicateOf?: string }
export async function uploadFile(api: Api, patientId: string, file: { name: string; buffer: Buffer }, fields: Record<string, string> = {}): Promise<Uploaded & { http: number }> {
  const r = await api.upload(`/api/patients/${patientId}/documents`, file, { intakeRoute: 'bulk', ...fields })
  if (!r.ok) throw new Error(`upload ${file.name} failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { ...r.body, http: r.status }
}
export const uploadDemo = (api: Api, patientId: string, file: string) => uploadFile(api, patientId, demoDoc(file))

export type DocStatus = { id: string; status: string; stage: string; docType: string | null; events: number; identity: { result: string | null; attachState: string }; flags: Record<string, any> }
/** Polls the status route (it also starts the runner for a queued document) until processing stops. */
export async function waitDoc(api: Api, documentId: string, timeoutMs = 150_000): Promise<DocStatus> {
  const end = Date.now() + timeoutMs
  let last: DocStatus | undefined
  for (;;) {
    const r = await api.get<DocStatus>(`/api/documents/${documentId}/status`)
    if (!r.ok) throw new Error(`status ${documentId}: ${r.status} ${JSON.stringify(r.body)}`)
    last = r.body
    if (SETTLED.has(last.status)) return last
    if (Date.now() > end) throw new Error(`document ${documentId} still ${last.status}/${last.stage} after ${timeoutMs} ms`)
    await new Promise((res) => setTimeout(res, 1500))
  }
}
export async function uploadAndWait(api: Api, patientId: string, file: string) {
  const u = await uploadDemo(api, patientId, file)
  return { ...u, doc: await waitDoc(api, u.documentId) }
}

// ── small conveniences ───────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Polls until `fn` returns something truthy (rows written after a response, e.g. by `after()`). */
export async function until<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`condition not met within ${timeoutMs} ms`)
    await sleep(500)
  }
}
