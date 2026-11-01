// Demo reset + seed for the Narmada org (docs/DEMO.md). Idempotent: every run wipes Narmada's patient data first.
//   npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000
//
// Every patient-scoped row is produced by the app's own HTTP API, driven as the demo desk / records / clinician /
// admin staff and as the patient or caregiver (OTP read from the simulated phone, GET /api/demo/outbox).
// The script writes to the DB directly (owner role) only for:
//   1. the reset (one transaction; append-only triggers disabled only inside it),
//   2. the returning patient's first visit: org_settings.demo_clock_offset_s is set NEGATIVE (no API accepts one) so
//      that visit, its uploads and its seal happen "on 16 Feb 2026" through the normal API and now(); the clock is then
//      reset through POST /api/admin/settings/demo-clock,
//   3. that visit's encounter start, re-dated to 16 Feb 2026 (registration stamps encounters with the real DB time,
//      not the org clock), so the desk check-in today opens a new "returning" encounter.
// Reads (ids, ledger tiers, the summary) use the app's own server functions over the owner connection.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { adminDb, closeDb, type Tx } from '../src/db'
import {
  caregivers, documents, encounters, events, missingRecords, organisations, orgSettings, outbox, patients, recordRequests,
  shareLinks, snapshots,
} from '../src/db/schema'
import { decryptJson, encryptJson, fromB64url, payloadDigest, SHARE_SIG_CONTEXT } from '../src/components/shares/crypto'
import { istDate, lintText } from '../src/core/copy'
import { RADAR_RULES } from '../src/core/radar/rules'
import { CONSENT_NOTICE_VERSION } from '../src/i18n/consent'
import { phoneHmac } from '../src/server/crypto'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../src/server/demo'
import type { ItemView } from '../src/server/ledger/core'
import { loadLedger } from '../src/server/ledger/record'
import { describeRows } from '../src/server/radar-ui/completeness'

const argBase = process.argv.indexOf('--base')
const BASE = (argBase > 0 ? process.argv[argBase + 1] : 'http://localhost:3000').replace(/\/$/, '')
const DEPLOYED = 'https://oncosetu-zeta.vercel.app'
const DOCS = path.resolve(__dirname, '../public/demo-docs')
const N = ORG_NARMADA_ID
const SHARE_PASSCODE = '246810'
const RETURNING_S0_AT = Date.parse('2026-02-16T10:30:00+05:30') // the returning patient's previous visit
const SHADOW_RULE = 'RAD-IMG-PT-01' // left in shadow so the shadow-mode mechanism is demonstrable
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`)

// ── HTTP: one cookie jar per actor ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any
class Client {
  cookie = ''
  constructor(readonly who: string, readonly base = BASE) {}
  async call(method: string, url: string, body?: unknown, ok = [200]): Promise<J> {
    const headers: Record<string, string> = { origin: this.base }
    if (this.cookie) headers.cookie = this.cookie
    let payload: FormData | string | undefined
    if (body instanceof FormData) payload = body
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' })
    const sid = res.headers.getSetCookie().find((c) => c.startsWith('os_sid='))
    if (sid) this.cookie = sid.split(';')[0]
    const text = await res.text()
    if (!ok.includes(res.status)) throw new Error(`${this.who} ${method} ${url} → ${res.status} ${text.slice(0, 400)}`)
    try { return text ? JSON.parse(text) : {} } catch { return { status: res.status, text } }
  }
  get = (url: string, ok?: number[]) => this.call('GET', url, undefined, ok)
  post = (url: string, body?: unknown, ok?: number[]) => this.call('POST', url, body, ok)
}
const anon = new Client('public')

async function staffLogin(email: string): Promise<Client & { staffId: string; role: string }> {
  const { accounts } = await anon.get('/api/auth/demo-accounts')
  const a = (accounts as J[]).find((x) => x.email === email)
  if (!a) throw new Error(`demo account ${email} missing: run scripts/seed-base.ts`)
  const c = new Client(a.role)
  await c.post('/api/auth/staff/login', { email, password: a.password, totp: a.totp })
  const { session } = await c.get('/api/auth/me')
  return Object.assign(c, { staffId: session.staffId as string, role: session.role as string })
}

/** The newest code the simulated phone received for this template. */
async function codeFor(phone: string, templateKey: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const { messages } = await anon.get(`/api/demo/outbox?phone=${encodeURIComponent(phone)}`)
    const m = (messages as J[]).find((x) => x.templateKey === templateKey)
    const code = m?.body.match(/\b\d{6}\b/)?.[0]
    if (code) return code
    await sleep(500)
  }
  throw new Error(`no ${templateKey} code for the demo phone`)
}

async function portalLogin(who: string, phone: string): Promise<Client> {
  const c = new Client(who)
  await c.post('/api/auth/patient/otp/start', { phone })
  await c.post('/api/auth/patient/otp/verify', { phone, code: await codeFor(phone, 'auth.otp') })
  return c
}

// ── patients ─────────────────────────────────────────────────────────────────
type Spec = {
  key: string; fullName: string; aliases: string[]; sex: 'female' | 'male'; dob: string; phone?: string; lang: 'en' | 'hi'
  caregiver: { name: string; relation: string; phone: string; isGuardian: boolean } | null; primary: 'patient' | 'caregiver'
}
const json = JSON.parse(readFileSync(path.join(DOCS, 'patients.json'), 'utf8')) as J[]
const fromJson = (key: string, lang: 'en' | 'hi'): Spec => {
  const p = json.find((x) => x.patientKey === key)
  return {
    key, fullName: p.fullName, aliases: p.aliases, sex: p.sex, dob: p.dob, phone: p.phone, lang, primary: p.primaryContact,
    caregiver: p.caregiver ? { ...p.caregiver, isGuardian: false } : null,
  }
}
const HERO = fromJson('hero', 'hi') // disclosure stays `unknown` (PRD hero), not patients.json's not_cleared
const RETURNING = fromJson('returning', 'en')
const FULFILLED = fromJson('fulfilled', 'en')
const MINOR: Spec = {
  key: 'minor', fullName: 'Aarav Kulkarni', aliases: [], sex: 'male', dob: '2014-06-18', lang: 'en', primary: 'caregiver',
  caregiver: { name: 'Pooja Kulkarni', relation: 'mother', phone: '+91 98500 11223', isGuardian: true },
}
const contactPhone = (s: Spec) => (s.primary === 'caregiver' ? s.caregiver!.phone : s.phone!)
const PURPOSES = { store: true, ai: false, share: true, abdm: false, metrics: true }

/**
 * POST /api/patients with consent confirmed by the code sent to the primary contact. Registration itself opens the
 * onboarding encounter (the person is at the desk), so no separate check-in: the SMS flood guard allows only 3 codes
 * per phone in 10 minutes (src/server/otp.ts OTP_SEND_LIMITS), and the live demo needs two more for the hero's son.
 */
async function register(desk: Client, s: Spec): Promise<{ id: string; encounterId: string }> {
  await desk.post('/api/desk/consent-otp', { phone: contactPhone(s), language: s.lang })
  const code = await codeFor(contactPhone(s), 'consent.otp')
  const r = await desk.call('POST', '/api/patients', {
    fullName: s.fullName, sex: s.sex, dob: s.dob, ...(s.phone ? { phone: s.phone } : {}), preferredLanguage: s.lang,
    aliases: s.aliases.map((name) => ({ name, kind: /[^\x00-\x7F]/.test(name) ? 'transliteration' : 'other' })),
    disclosureStatus: 'unknown', primaryContact: s.primary, ...(s.caregiver ? { caregiver: s.caregiver } : {}),
    consent: { purposes: PURPOSES, language: s.lang, noticeVersion: CONSENT_NOTICE_VERSION, confirm: { method: 'otp', code } },
  }, [200, 409])
  if (r.error) throw new Error(`register ${s.key}: ${r.error.code} — the org was empty after the reset, so another writer registered this person in Narmada during the run: ${JSON.stringify(r.candidates)}`)
  return { id: r.id, encounterId: r.encounterId }
}

async function deskCheckIn(desk: Client, s: Spec, patientId: string): Promise<{ encounterId: string; encounterType: string }> {
  await desk.post('/api/desk/verify/start', { patientId })
  return desk.post('/api/desk/verify/code', { patientId, code: await codeFor(contactPhone(s), 'desk.otp') })
}

// ── documents ────────────────────────────────────────────────────────────────
const TERMINAL = new Set(['done', 'needs_review', 'failed', 'unreadable', 'quarantined'])
const docIds = new Map<string, string>() // file name → document id (this run)
const fileOf = (docId: string | null | undefined) => [...docIds].find(([, id]) => id === docId)?.[0] ?? null

async function upload(c: Client, patientId: string, files: string[], extra: Record<string, string> = {}): Promise<string[]> {
  const ids: string[] = []
  for (const f of files) {
    const fd = new FormData()
    fd.set('file', new File([readFileSync(path.join(DOCS, f))], f, { type: f.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }))
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    const r = await c.post(`/api/patients/${patientId}/documents`, fd)
    docIds.set(f, r.documentId)
    ids.push(r.documentId)
  }
  return ids
}

/** Polls the status route (which also restarts a stale runner) until every document reaches a terminal state. */
async function waitProcessed(c: Client, ids: string[]) {
  const pending = new Set(ids)
  const deadline = Date.now() + 12 * 60_000
  while (pending.size) {
    for (const id of [...pending]) if (TERMINAL.has((await c.get(`/api/documents/${id}/status`)).status)) pending.delete(id)
    if (!pending.size) return
    if (Date.now() > deadline) throw new Error(`documents still processing after 12 min: ${[...pending].map(fileOf).join(', ')}`)
    await sleep(2500)
  }
}

// ── ledger (read with the app's own view model; writes through the verify API) ──
const orgNow = async () => {
  const [s] = await adminDb.select({ o: orgSettings.demoClockOffsetS }).from(orgSettings).where(eq(orgSettings.orgId, N))
  return new Date(Date.now() + (s?.o ?? 0) * 1000)
}
const ledgerFor = async (patientId: string, actor: { staffId: string; role: string }) =>
  adminDb.transaction(async (tx) => loadLedger(tx as unknown as Tx, patientId, actor, await orgNow()))
const allItems = (v: Awaited<ReturnType<typeof ledgerFor>>) => Object.values(v.events).flat()

/** Opens the source (FR-VER-03) and verifies each unverified item this actor may verify and `pick` selects. */
async function verify(c: Client & { staffId: string; role: string }, patientId: string, pick: (it: ItemView) => boolean): Promise<number> {
  const items = allItems(await ledgerFor(patientId, c)).filter((it) => it.status === 'unverified' && it.permits.verify === true && pick(it))
  for (const it of items) {
    await c.post(`/api/events/${it.id}/viewed`)
    await c.post(`/api/events/${it.id}/verify`, { action: 'verify', rowVersion: it.rowVersion })
  }
  return items.length
}
/** FR-CON-07: diagnosis-class words in text a not-cleared patient, caregiver or share viewer sees. */
const diagnosisWords = (texts: string[]) => [...new Set(texts.flatMap((t) => lintText(t, ['diagnosis']).map((h) => h.match)))]
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
  : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => k !== 'sig').flatMap(([, x]) => strings(x)) : [])
const fromFiles = (files: string[]) => (it: ItemView) => it.sources.some((s) => files.includes(fileOf(s.documentId) ?? ''))

/** POST /api/requests prefilled the way the completeness page's "Request" button prefills it (trigger institution, expected types, window). */
async function requestFor(c: Client, patientId: string, ruleId: string, lang: 'en' | 'hi'): Promise<string> {
  const [item] = await adminDb.select().from(missingRecords)
    .where(and(eq(missingRecords.patientId, patientId), eq(missingRecords.ruleId, ruleId), eq(missingRecords.mode, 'production')))
  if (!item) throw new Error(`no production ${ruleId} item to request`)
  const [it] = await adminDb.transaction((tx) => describeRows(tx as unknown as Tx, [item]))
  const { from, to } = it.window
  const r = await c.post('/api/requests', {
    patientId, missingIds: [item.id], institution: it.trigger?.institution ?? it.triggerDoc?.institution, documents: it.expectedTypes, lang,
    ...(from || to ? { dateRange: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } : {}),
  })
  return r.id
}

/** What the share viewer does after decrypting: Ed25519 over SHARE_SIG_CONTEXT + digest, with the key from that origin's /api/keys. */
async function signatureValid(origin: string, p: J): Promise<boolean> {
  if (!p.sig?.signature) return false
  const { keys } = await new Client('keys', origin).get('/api/keys')
  const k = (keys as J[]).find((x) => x.keyId === p.sig.keyId)
  if (!k) return false
  const key = await crypto.subtle.importKey('raw', fromB64url(k.publicKeyRaw), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64url(p.sig.signature), new TextEncoder().encode(SHARE_SIG_CONTEXT + await payloadDigest(p)))
}

// ── 1. reset ─────────────────────────────────────────────────────────────────
/** Child → parent order (FKs are not deferrable). `sessions` and `staff` are handled separately. */
const ORG_TABLES = [
  'share_views', 'share_links', 'record_requests', 'missing_records', 'verification_qa_reviews', 'measurement_form_doc_types',
  'measurement_forms', 'verifications', 'evidence', 'snapshots', 'ai_runs', 'events', 'patient_statements', 'document_pages',
  'document_files', 'documents', 'break_glass', 'erasure_requests', 'consents', 'patient_merges', 'caregivers', 'patient_aliases',
  'outbox', 'encounters', 'patients', 'audit_log', 'devices', 'rule_states',
]
/** drizzle's sql`` expands a JS array into a tuple; pass a Postgres array literal instead. */
const pgArr = (xs: string[]) => `{${xs.map((x) => `"${x}"`).join(',')}}`
const DEMO_PHONES = [HERO, RETURNING, FULFILLED, MINOR].flatMap((s) => [s.phone, s.caregiver?.phone]).filter((p): p is string => !!p)

async function reset() {
  await adminDb.transaction(async (tx) => {
    const orgTables = (await tx.execute<{ t: string }>(sql`select table_name t from information_schema.columns
      where table_schema = 'public' and column_name = 'org_id'`)).map((r) => r.t)
    const unknown = orgTables.filter((t) => ![...ORG_TABLES, 'sessions', 'staff', 'org_settings'].includes(t))
    if (unknown.length) throw new Error(`reset: unknown org-scoped table(s) ${unknown.join(', ')} — add them to ORG_TABLES`)
    const residue = (await tx.select({ id: organisations.id }).from(organisations)
      .where(and(ne(organisations.id, N), ne(organisations.id, ORG_GANGA_ID)))).map((o) => o.id)
    const wiped = [N, ...residue]
    // OTP challenges carry no org: clear the demo phones and every phone of the records being removed.
    const hm = await tx.execute<{ h: string }>(sql`select phone_hmac h from patients where org_id = any(${pgArr(wiped)}::uuid[]) and phone_hmac is not null
      union select phone_hmac from caregivers where org_id = any(${pgArr(wiped)}::uuid[])`)
    const phones = [...new Set([...hm.map((r) => r.h), ...DEMO_PHONES.map((p) => phoneHmac(p)!)])]

    for (const o of wiped) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'audit:' + o}, 0))`)
    await tx.execute(sql`alter table audit_log disable trigger audit_log_append_only`)
    await tx.execute(sql`alter table snapshots disable trigger snapshots_append_only`)
    await tx.execute(sql`delete from sessions where org_id = ${N} and kind <> 'staff'`)
    await tx.execute(sql`delete from sessions where org_id = any(${pgArr(residue)}::uuid[])`)
    for (const t of ORG_TABLES) await tx.execute(sql`delete from ${sql.identifier(t)} where org_id = any(${pgArr(wiped)}::uuid[])`)
    await tx.execute(sql`delete from otp_challenges where phone_hmac = any(${pgArr(phones)}::text[])`)
    if (residue.length) {
      await tx.execute(sql`delete from staff where org_id = any(${pgArr(residue)}::uuid[])`)
      await tx.execute(sql`delete from org_settings where org_id = any(${pgArr(residue)}::uuid[])`)
      await tx.execute(sql`delete from organisations where id = any(${pgArr(residue)}::uuid[])`)
    }
    await tx.execute(sql`alter table audit_log enable trigger audit_log_append_only`)
    await tx.execute(sql`alter table snapshots enable trigger snapshots_append_only`)
    await tx.insert(orgSettings).values({ orgId: N }).onConflictDoUpdate({
      target: orgSettings.orgId, set: { flags: { voice: false, tts: false, ai_extraction: false }, demoClockOffsetS: 0, retentionDays: 3650, updatedAt: new Date() },
    })
    for (const t of ORG_TABLES) {
      const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int n from ${sql.identifier(t)} where org_id = ${N}`)
      if (n) throw new Error(`reset: ${t} still has ${n} Narmada rows`)
    }
    step(`reset: Narmada wiped${residue.length ? `, removed ${residue.length} residue org(s)` : ''}; ${phones.length} phones' OTP challenges cleared`)
  })
  // A demo phone shared with another org's patient would make the portal login open the wrong record (otp verify takes logins[0]).
  const clash = await adminDb.execute<{ n: number }>(sql`select count(*)::int n from (select phone_hmac from patients where phone_hmac = any(${pgArr(DEMO_PHONES.map((p) => phoneHmac(p)!))}::text[])
    union all select phone_hmac from caregivers where phone_hmac = any(${pgArr(DEMO_PHONES.map((p) => phoneHmac(p)!))}::text[])) x`)
  if (clash[0].n) throw new Error(`a demo phone is already used by ${clash[0].n} record(s) in another org`)
}

const setClockOffset = (s: number) => adminDb.update(orgSettings).set({ demoClockOffsetS: s, updatedAt: new Date() }).where(eq(orgSettings.orgId, N))

// ── main ─────────────────────────────────────────────────────────────────────
type Staff = Awaited<ReturnType<typeof staffLogin>>
const out: { shareId?: string; shareKey?: string; ids: Record<string, string> } = { ids: {} }

async function main() {
  step(`base ${BASE}`)
  await reset()
  const [desk, records, clinician, admin] = await Promise.all(
    ['desk', 'records', 'clinician', 'admin'].map((r) => staffLogin(`${r}@narmada.demo`)),
  ) as Staff[]

  // 2. rule review: Dr. Meera Iyer reviewed every rule except the one left in shadow
  for (const r of RADAR_RULES.filter((x) => x.id !== SHADOW_RULE)) {
    await admin.post(`/api/admin/rules/${r.id}`, { mode: 'production', reviewerId: clinician.staffId, confirm: true })
  }
  step(`rules: ${RADAR_RULES.length - 1} in production (reviewed by Dr. Meera Iyer), ${SHADOW_RULE} in shadow`)

  // 3a. returning patient — previous visit on 16 Feb 2026 (org clock moved back; see header)
  await setClockOffset(Math.round((RETURNING_S0_AT - Date.now()) / 1000))
  const ret = await register(desk, RETURNING)
  out.ids.returning = ret.id
  await clinician.post(`/api/patients/${ret.id}/disclosure`, { status: 'cleared', reason: 'patient_informed' })
  const prev = ['returning__01-discharge-summary.pdf', 'returning__02-histopathology.pdf', 'returning__03-chemo-cycle1.pdf']
  await waitProcessed(records, await upload(desk, ret.id, prev, { intakeRoute: 'desk', encounterId: ret.encounterId }))
  const vr = await verify(records, ret.id, () => true)
  const vc = await verify(clinician, ret.id, () => true)
  const s0 = await clinician.post(`/api/patients/${ret.id}/seal`)
  step(`returning: registered, disclosure cleared, 3 docs processed, ${vr} items verified by records + ${vc} by clinician, S0 sealed ${s0.sealedAt}`)
  await admin.post('/api/admin/settings/demo-clock', { preset: 'reset' })
  await adminDb.update(encounters).set({ startedAt: new Date(RETURNING_S0_AT) }).where(eq(encounters.id, ret.encounterId))

  // 3b. returning patient — pre-visit answers in the portal, then today's desk check-in and new documents
  const retPortal = await portalLogin('patient', RETURNING.phone!)
  await retPortal.post('/api/p/statements', {
    lang: 'en', confirmation: 'confirmed',
    answers: {
      other_hospital: { yn: 'yes', place: 'City Care Hospital, Nagpur', month: 5, year: 2026 },
      new_medicines: { yn: 'yes', names: 'Tab. Lapatinib 250 mg', place: 'City Care Hospital, Nagpur', month: 5, year: 2026 },
      new_tests: { yn: 'yes', testKind: 'scan', names: 'PET-CT', place: 'City Care Hospital, Nagpur', month: 4, year: 2026 },
      admissions: { yn: 'no' },
      anything_else: { yn: 'no' },
    },
  })
  const visit = await deskCheckIn(desk, RETURNING, ret.id)
  const later = ['returning__04-lab-cbc-lft.jpg', 'returning__05-chemo-cycle2.pdf', 'returning__06-prescription.pdf', 'returning__07-histopathology-addendum.pdf']
  await waitProcessed(records, await upload(desk, ret.id, later, { intakeRoute: 'desk', encounterId: visit.encounterId }))
  step(`returning: pre-visit answers confirmed, ${visit.encounterType} encounter opened, 4 new docs processed`)

  // 3c. hero — first visit, caregiver-primary, disclosure unknown; hero__10/11 stay for the live demo
  const hero = await register(desk, HERO)
  out.ids.hero = hero.id
  const backlog = [
    'hero__01-discharge-summary.pdf', 'hero__02-chemo-daycare-cycle4.pdf', 'hero__03-ct-thorax-abdomen.jpg', 'hero__04-prescription-printed.pdf',
    'hero__05-prescription-handwritten.jpg', 'hero__06-cbc-hindi.jpg', 'hero__07-wrong-patient-histopathology.pdf',
    'hero__08-lab-report-injection.pdf', 'hero__09-mammography-2024.pdf',
  ]
  await waitProcessed(records, await upload(desk, hero.id, backlog, { intakeRoute: 'bulk', encounterId: hero.encounterId }))
  // Records verifies the records-tier items of the printed prescription and the CBC; the injection-flagged LFT report
  // (hero__08) is left for a person to review on stage.
  const vh = await verify(records, hero.id, fromFiles(['hero__04-prescription-printed.pdf', 'hero__06-cbc-hindi.jpg']))
  // An open request given to the hospital today, so the admin's "+7 days" on stage produces a reminder (the histopathology
  // request made live is fulfilled by hero__10 before that step).
  const heroReq = await requestFor(records, hero.id, 'RAD-CHEMO-PRIOR-01', 'en')
  await records.post(`/api/requests/${heroReq}/sent`, {})
  step(`hero: registered, 9 docs processed, ${vh} items verified by records, cycles 1–3 request given today`)

  // 3d. fulfilled — admission summary → request → caregiver uploads the discharge summary → closure confirmed → S0 → share
  const ful = await register(desk, FULFILLED)
  out.ids.fulfilled = ful.id
  await waitProcessed(records, await upload(desk, ful.id, ['fulfilled__01-admission-summary.pdf'], { intakeRoute: 'desk', encounterId: ful.encounterId }))
  const reqId = await requestFor(records, ful.id, 'RAD-ADM-DS-01', 'en')
  const [item] = await adminDb.select().from(missingRecords).where(and(eq(missingRecords.patientId, ful.id), eq(missingRecords.ruleId, 'RAD-ADM-DS-01')))
  const sentOn = istDate(new Date(Date.now() - 12 * 86_400_000).toISOString())
  await records.post(`/api/requests/${reqId}/sent`, { sentOn })
  await records.get(`/api/requests?patientId=${ful.id}`) // the read that tracks the request: 7-day reminder goes out
  const cg = await portalLogin('caregiver', FULFILLED.caregiver!.phone)
  const before = new Set((await records.get(`/api/patients/${ful.id}/documents`)).rows.map((r: J) => r.id))
  const fd = new FormData()
  fd.set('file', new File([readFileSync(path.join(DOCS, 'fulfilled__02-discharge-summary.pdf'))], 'fulfilled__02-discharge-summary.pdf', { type: 'application/pdf' }))
  await cg.post('/api/p/documents', fd)
  const arrived = (await records.get(`/api/patients/${ful.id}/documents`)).rows.map((r: J) => r.id).find((id: string) => !before.has(id))
  docIds.set('fulfilled__02-discharge-summary.pdf', arrived)
  await waitProcessed(records, [arrived])
  const [proposed] = await adminDb.select().from(missingRecords).where(eq(missingRecords.id, item.id))
  if (proposed.state !== 'received' || proposed.proposedDocumentId !== arrived) {
    throw new Error(`fulfilled: expected the item proposed closed by fulfilled__02, got state=${proposed.state} proposed=${fileOf(proposed.proposedDocumentId)}`)
  }
  await records.post(`/api/missing/${item.id}/transition`, { action: 'confirm' })
  const vf = await verify(clinician, ful.id, () => true)
  const s0f = await clinician.post(`/api/patients/${ful.id}/seal`)
  const payload = await cg.get('/api/p/share-payload?scope=index')
  const enc = await encryptJson(payload)
  const share = await cg.post('/api/shares', { snapshotId: payload.snapshotId, ciphertext: enc.ciphertext, iv: enc.iv, scope: 'index', expiresInDays: 7, passcode: SHARE_PASSCODE })
  out.shareId = share.id
  out.shareKey = enc.key
  step(`fulfilled: request sent ${sentOn}, discharge summary arrived via caregiver, closure confirmed, ${vf} items verified, S0 ${s0f.sha256.slice(0, 12)}…, share link created`)

  // 3e. minor — guardian-primary, no documents
  out.ids.minor = (await register(desk, MINOR)).id
  step('minor: registered with guardian consent')

  // 4. checks + summary
  const failures = await summarise({ desk, records, clinician, admin })
  for (const c of [desk, records, clinician, admin, retPortal, cg]) await c.post('/api/auth/logout', undefined, [200, 401])
  step(failures.length ? `FAILED ${failures.length} check(s)` : 'all checks passed')
  for (const f of failures) console.log(`  ✗ ${f}`)
  if (failures.length) process.exitCode = 1
}

// ── 4. assertions + summary ──────────────────────────────────────────────────
async function summarise(staff: Record<'desk' | 'records' | 'clinician' | 'admin', Staff>): Promise<string[]> {
  const fail: string[] = []
  const check = (ok: unknown, msg: string) => { if (!ok) fail.push(msg) }
  const wordingOf = (m: typeof missingRecords.$inferSelect) => ((m.matchWindow as J)?.wording?.en as string | undefined) ?? m.ruleId

  for (const [key, id] of Object.entries(out.ids)) {
    const [p] = await adminDb.select().from(patients).where(eq(patients.id, id))
    const docs = await adminDb.select().from(documents).where(eq(documents.patientId, id)).orderBy(asc(documents.receivedAt))
    const evs = await adminDb.select().from(events).where(and(eq(events.patientId, id), isNull(events.withdrawnAt)))
    const miss = await adminDb.select().from(missingRecords).where(eq(missingRecords.patientId, id)).orderBy(asc(missingRecords.ruleId))
    const reqs = await adminDb.select().from(recordRequests).where(eq(recordRequests.patientId, id))
    const snaps = await adminDb.select().from(snapshots).where(eq(snapshots.patientId, id)).orderBy(asc(snapshots.seq))
    const cgs = await adminDb.select().from(caregivers).where(eq(caregivers.patientId, id))
    const live = evs.filter((e) => !e.documentId || docs.some((d) => d.id === e.documentId && ['auto', 'attached'].includes(d.attachState)))
    const verified = live.filter((e) => ['verified_matches_source', 'edited'].includes(e.verificationStatus)).length

    console.log(`\n── ${key.toUpperCase()} · ${id} · disclosure=${p.disclosureStatus} · primary=${p.primaryContact}${p.minor ? ' · MINOR' : ''} · lang=${p.preferredLanguage}`)
    if (docs.length) {
      console.table(docs.map((d) => ({
        file: fileOf(d.id) ?? d.id, status: d.status, docType: d.docType, identity: d.identityResult, attach: d.attachState,
        events: evs.filter((e) => e.documentId === d.id).length,
        verified: evs.filter((e) => e.documentId === d.id && e.verificationStatus !== 'unverified').length,
        flags: [d.injectionFlag && 'injection', d.handwritten && 'handwritten', d.lowConfidence && 'low_conf', d.amendmentOf && `amends ${fileOf(d.amendmentOf)}`].filter(Boolean).join(' '),
      })))
    }
    console.log(`events in record: ${live.length} (verified ${verified}, unverified ${live.length - verified})`)
    for (const m of miss) console.log(`  [${m.mode.padEnd(10)}] ${m.state.padEnd(9)} ${m.ruleId.padEnd(18)} ${wordingOf(m)}${m.proposedDocumentId ? `  ⇢ proposed ${fileOf(m.proposedDocumentId)}${m.notes ? ` (${m.notes})` : ''}` : ''}`)
    for (const r of reqs) console.log(`  request ${r.id.slice(0, 8)} ${r.lang} ${r.institution}: ${r.state}; sent ${r.sentAt?.toISOString().slice(0, 10)}; reminder7 ${r.reminder7SentAt ? 'sent' : '—'}; fulfilled ${r.fulfilledAt?.toISOString().slice(0, 10) ?? '—'} by ${fileOf(r.fulfilledDocumentId) ?? '—'}`)
    for (const s of snaps) {
      const v = await anon.get(`/api/snapshots/${s.id}/verify`)
      console.log(`  S${s.seq} ${s.id} sealed ${s.sealedAt.toISOString()} sha256 ${s.sha256.slice(0, 16)}… hash ${v.hashMatches ? 'ok' : 'BAD'} · signature ${v.signatureValid ? 'valid' : 'INVALID'} · /verify/${s.id}`)
      check(v.hashMatches && v.signatureValid, `${key}: S${s.seq} does not verify`)
    }
    if (p.disclosureStatus !== 'cleared') {
      const sms = await adminDb.select({ body: outbox.body }).from(outbox).where(eq(outbox.patientId, id))
      const hits = diagnosisWords(sms.map((m) => m.body))
      console.log(`  outbox: ${sms.length} message(s) to this patient's contacts; diagnosis words: ${hits.length ? hits.join(', ') : 'none'}`)
      check(!hits.length, `${key}: diagnosis words in SMS to a not-cleared contact: ${hits.join(', ')}`)
    }
    const prodOpen = (rule: string) => miss.find((m) => m.ruleId === rule && m.mode === 'production' && ['expected', 'requested', 'received'].includes(m.state))
    const byFile = (f: string) => docs.find((d) => d.id === docIds.get(f))

    if (key === 'hero') {
      check(p.disclosureStatus === 'unknown' && p.primaryContact === 'caregiver' && cgs[0]?.relation === 'son', 'hero: disclosure/primary contact wrong')
      check(wordingOf(prodOpen('RAD-SURG-HPE-01')!)?.startsWith('Histopathology report not in file'), 'hero: no production "Histopathology report not in file" item')
      check(['RAD-HPE-IHC-01', 'RAD-PEND-01'].some((r) => /IHC report mentioned as pending.*not in file/.test(prodOpen(r) ? wordingOf(prodOpen(r)!) : '')), 'hero: no production "IHC report mentioned as pending … not in file" item')
      const chemo = miss.filter((m) => m.ruleId === 'RAD-CHEMO-PRIOR-01' && m.mode === 'production')
      check(chemo.length === 1 && /cycles 1–3/.test(wordingOf(chemo[0])), 'hero: expected ONE grouped "Chemotherapy records for cycles 1–3" item')
      const wrong = byFile('hero__07-wrong-patient-histopathology.pdf')
      check(wrong?.attachState === 'pending_decision' && wrong.identityResult === 'mismatch', 'hero: wrong-patient report is not held for an identity decision')
      check(!evs.some((e) => e.documentId === wrong?.id), 'hero: events derived from the wrong-patient report')
      check(byFile('hero__08-lab-report-injection.pdf')?.injectionFlag, 'hero: injected document not flagged')
      const hw = byFile('hero__05-prescription-handwritten.jpg')
      check(hw?.handwritten && !evs.some((e) => e.documentId === hw.id), 'hero: handwritten prescription not image-only')
      check(verified > 0 && verified < live.length, 'hero: expected a mix of verified and unverified items')
      check(!snaps.length, 'hero: should have no snapshot (sealed live)')
      check(reqs.length === 1 && reqs[0].state === 'sent', 'hero: expected one request given today (state sent)')
    }
    if (key === 'returning') {
      check(p.disclosureStatus === 'cleared' && p.primaryContact === 'patient', 'returning: disclosure/primary contact wrong')
      check(snaps.length === 1 && istDate(snaps[0].sealedAt.toISOString()) === '2026-02-16', 'returning: S0 not sealed as of 16 Feb 2026')
      const view = await ledgerFor(id, staff.clinician)
      console.log(`  Change Ledger (clinician): new since last visit ${view.events.new_since_last_visit.length} · newly received older ${view.events.newly_received_older.length} · amended ${view.events.amended.length} · conflicts ${view.conflicts.length} · patient said ${view.patientSaid.length} · missing ${view.missing.length} · duplicates ${view.duplicates.count}`)
      for (const c of view.conflicts) console.log(`    conflict ${c.label}: "${c.sides[0].value}" vs "${c.sides[1].value}"`)
      check(view.mode === 'diff' && view.events.new_since_last_visit.length, 'returning: ledger has no "New since last visit"')
      check(view.events.amended.length, 'returning: ledger has no "Amended" item')
      check(view.conflicts.some((c) => c.kind === 'medication_names'), 'returning: ledger has no medicine conflict')
      check(view.patientSaid.length, 'returning: ledger has no "Patient said"')
      check(miss.some((m) => m.ruleId === SHADOW_RULE && m.mode === 'shadow'), `returning: no shadow ${SHADOW_RULE} item`)
    }
    if (key === 'fulfilled') {
      check(reqs.length === 1 && reqs[0].state === 'fulfilled' && reqs[0].reminder7SentAt, 'fulfilled: request not fulfilled with a 7-day reminder')
      const sms = await adminDb.select({ k: outbox.templateKey }).from(outbox).where(and(eq(outbox.patientId, id), eq(outbox.templateKey, 'request.reminder7')))
      check(sms.length === 1, 'fulfilled: no request.reminder7 message in the outbox')
      check(miss.some((m) => m.ruleId === 'RAD-ADM-DS-01' && m.state === 'closed'), 'fulfilled: discharge-summary item not closed')
      check(snaps.length === 1, 'fulfilled: expected S0')
      const links = await adminDb.select().from(shareLinks).where(eq(shareLinks.patientId, id))
      check(links.length === 1 && links[0].passcodeHash, 'fulfilled: share link missing or without passcode')
    }
    if (key === 'minor') check(p.minor && p.primaryContact === 'caregiver' && cgs[0]?.isGuardian && !docs.length, 'minor: flags wrong')
  }

  // share link: opens with the passcode on both origins and decrypts with the fragment key
  console.log('\n── SHARE LINK (fulfilled patient, passcode ' + SHARE_PASSCODE + ', 7 days)')
  for (const origin of [BASE, DEPLOYED]) {
    const url = `${origin}/s/${out.shareId}#${out.shareKey}`
    try {
      const o = await new Client('viewer', origin).post(`/api/shares/${out.shareId}/open`, { passcode: SHARE_PASSCODE })
      const doc = await decryptJson<J>(out.shareKey!, o.ciphertext, o.iv)
      const signed = await signatureValid(origin, doc)
      console.log(`  ${url}\n    opens + decrypts: "${doc.heading.en}" · brand ${doc.brand} · ${doc.items.length} items · ${doc.absent.length} not in file · signature ${signed ? 'verified' : 'NOT verified'}`)
      check(doc.heading.en === 'Document index, not a clinical summary' && doc.brand === 'Setu Records', `share via ${origin}: heading/brand wrong`)
      check(signed, `share via ${origin}: payload signature does not verify against ${origin}/api/keys`)
      const hits = diagnosisWords(strings(doc))
      check(!hits.length, `share payload (disclosure unknown) contains diagnosis words: ${hits.join(', ')}`)
    } catch (e) {
      console.log(`  ${url}\n    FAILED: ${(e as Error).message}`)
      fail.push(`share link does not open via ${origin}`)
    }
  }
  const others = (await adminDb.select({ id: patients.id }).from(patients).where(eq(patients.orgId, N))).filter((p) => !Object.values(out.ids).includes(p.id))
  check(!others.length, `${others.length} other patient(s) were created in Narmada during the run by another writer — rerun when it stops`)
  const [org] = await adminDb.select({ o: orgSettings.demoClockOffsetS }).from(orgSettings).where(eq(orgSettings.orgId, N))
  check(org.o === 0, 'demo clock not reset')
  const chain = await staff.admin.post('/api/admin/audit/verify')
  console.log(`\naudit chain: ${JSON.stringify(chain)} · demo clock offset ${org.o}s`)
  const rules = await adminDb.execute<{ mode: string; n: number }>(sql`select mode, count(*)::int n from rule_states where org_id = ${N} group by mode`)
  console.log(`rule_states: ${rules.map((r) => `${r.mode} ${r.n}`).join(', ')} (no row = YAML default shadow)`)
  return fail
}

// Ctrl-C during the returning patient's first visit must not leave the shared org clock in February.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { void setClockOffset(0).finally(() => process.exit(130)) })
}

main()
  .catch(async (e) => {
    console.error(e)
    await setClockOffset(0).catch(() => {}) // never leave the shared org clock in the past
    process.exitCode = 1
  })
  .finally(async () => {
    step('done')
    await closeDb()
  })
