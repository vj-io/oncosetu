// FR-LED-07 production probe: does the change ledger render in <= 2 s for a 500-event patient WHERE IT RUNS (Vercel sin1, next to Neon
// Singapore)? Triggered by Vercel Cron (vercel.json, daily) or by hand with `vercel crons run /api/cron/perf-probe`, which makes Vercel itself
// send `Authorization: Bearer $CRON_SECRET`. Nobody has to type a credential against the deployed host.
//
// SECURITY. This route mints a real staff session cookie. It is acceptable only because:
//   1. it is OFF unless PERF_PROBE_ENABLED=true (404 otherwise, before anything else) and then needs the CRON_SECRET bearer, which Vercel
//      alone adds to a cron call;
//   2. the session is for ONE synthetic account, perf-probe@ganga.test: clinician, Ganga org only (never Narmada, whose data is the live demo),
//      not a demo account, and unable to log in at all (its password hash is not a valid scrypt hash and it has no TOTP secret). The route
//      refuses to mint if that account is not exactly that (someone gave it a password, moved it to another org, deactivated it);
//   3. each session lives 60 s (expiry and idle timeout), is used for exactly one request to this deployment's own ledger page, and is
//      deleted in `finally`. The token only exists in this function's memory (never logged, stored or returned); the row stores its SHA-256.
//   4. one audit row (`perf_probe.run`, ids only) records every run.
// Residual risk: anyone who can set PERF_PROBE_ENABLED=true and obtains the CRON_SECRET could read the Ganga synthetic patient's ledger.
// Both are Vercel project secrets, and that patient holds synthetic data only.
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { db, withOrg } from '@/db'
import { documentPages, documents, events, evidence, patients, sessions, staff } from '@/db/schema'
import { CONSENT_NOTICE_VERSION } from '@/i18n/consent'
import { writeAudit } from '@/server/audit'
import { now } from '@/server/clock'
import { randomToken, sha256Hex, timingSafeEqualStr } from '@/server/crypto'
import { ORG_GANGA_ID as ORG } from '@/server/demo'
import { HttpError, route } from '@/server/http'
import { loadLedger } from '@/server/ledger/record'
import { BUDGET_MS, MIN_ITEMS, countItems, median, verdictFor } from '@/server/perf/probe'
import type { AuditFn, StaffCtx } from '@/server/registration/http'
import type { RegisterBody } from '@/server/registration/schemas'
import { SESSION_COOKIE, type StaffSession } from '@/server/session'

export const maxDuration = 300

const PROBE_EMAIL = 'perf-probe@ganga.test'
const SESSION_TTL_MS = 60_000
const DEMO_PDF = 'hero__01-discharge-summary.pdf'
const r1 = (n: number) => Math.round(n * 10) / 10
/** NaN (nothing was timed) is stored as NULL. */
const nan = (n: number) => (Number.isFinite(n) ? n : null)

/** The synthetic account, created on first use. Returns its id; refuses an account that could be used for anything else. */
async function probeStaffId(): Promise<string> {
  await db.insert(staff).values({
    orgId: ORG, role: 'clinician', name: 'Perf Probe', email: PROBE_EMAIL, passwordHash: `!${randomToken(48)}`, isDemo: false, active: true,
  }).onConflictDoNothing({ target: staff.email })
  const [s] = await db.select().from(staff).where(eq(staff.email, PROBE_EMAIL))
  if (!s || s.orgId !== ORG || s.role !== 'clinician' || s.isDemo || !s.active || s.totpSecretEnc || s.passwordHash.startsWith('scrypt$')) {
    throw new Error('the perf-probe account is not the locked synthetic clinician; refusing to mint a session')
  }
  await db.delete(sessions).where(and(eq(sessions.staffId, s.id), lt(sessions.expiresAt, new Date()))) // left by a run that was killed mid-way
  return s.id
}

/** A 60-second staff session for the probe account, handed to `fn` as a Cookie header and deleted afterwards, whatever happens. */
async function withProbeSession<T>(staffId: string, fn: (cookie: string) => Promise<T>): Promise<T> {
  const token = randomToken(32)
  const [row] = await db.insert(sessions).values({
    tokenHash: sha256Hex(token), kind: 'staff', orgId: ORG, staffId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), idleTimeoutS: SESSION_TTL_MS / 1000,
  }).returning({ id: sessions.id })
  try {
    return await fn(`${SESSION_COOKIE}=${token}`)
  } finally {
    await db.delete(sessions).where(eq(sessions.id, row.id))
  }
}

/** The most recent active Ganga patient with at least MIN_ITEMS live events, or null. RLS limits it to Ganga. */
const findProbePatient = () => withOrg(ORG, async (tx) => {
  const [p] = await tx.select({ id: patients.id }).from(patients).where(and(
    eq(patients.status, 'active'),
    inArray(patients.id, tx.select({ id: events.patientId }).from(events).where(isNull(events.withdrawnAt)).groupBy(events.patientId).having(sql`count(*) >= ${MIN_ITEMS}`)),
  )).orderBy(desc(patients.createdAt)).limit(1)
  return p?.id ?? null
})

const TYPES = ['lab_report_documented', 'imaging_report_documented', 'prescription_documented', 'consultation_documented', 'pathology_report_documented'] as const
const fieldsFor = (type: (typeof TYPES)[number], n: string): Record<string, string | string[]> => {
  const institution_name = 'Ganga Valley Hospital'
  switch (type) {
    case 'lab_report_documented': return { test_name: `${n} Complete blood count`, institution_name }
    case 'imaging_report_documented': return { test_name: `${n} CT thorax and abdomen`, institution_name }
    case 'prescription_documented': return { medication_names: [`${n} Paracetamol`, 'Ondansetron'], institution_name }
    case 'consultation_documented': return { doctor_name: 'Dr Test', department_text: `${n} Outpatient clinic`, institution_name }
    case 'pathology_report_documented': return { test_name: `${n} Biopsy`, accession_number: `AC-${n}`, institution_name }
  }
}
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
const freshPhone = () => `+91 9${digits(4)} ${digits(5)}`

/**
 * Builds the probe patient the way tests/e2e/v06-perf.spec.ts does: registered through the registration server function, one real text-layer
 * PDF ingested and processed, then 500 events (one evidence row each, quoting that PDF's real page text) inserted. Everything runs under
 * `withOrg(Ganga)` as the app role, so RLS keeps it inside Ganga (the e2e spec uses the owner role; nothing here needs it).
 * The demo files are read from this deployment's own static `/demo-docs/*` (the function bundle does not carry `public/`).
 */
async function createProbePatient(staffId: string, origin: string, headers: HeadersInit): Promise<string> {
  const [{ registerPatient }, { ingestDocument }, { runDocument }] = await Promise.all([
    import('@/server/registration/register'), import('@/server/pipeline/ingest'), import('@/server/pipeline/process'),
  ])
  const asset = async (name: string) => {
    const r = await fetch(`${origin}/demo-docs/${name}`, { headers, cache: 'no-store' })
    if (!r.ok) throw new Error(`demo asset ${name}: HTTP ${r.status}`)
    return r
  }
  const hero = ((await (await asset('patients.json')).json()) as { patientKey: string; fullName: string; aliases: string[]; dob: string; sex: 'female' | 'male'; preferredLanguage: 'en' | 'hi'; caregiver: { name: string; relation: string } | null }[])
    .find((p) => p.patientKey === 'hero')!
  const pdf = new Uint8Array(await (await asset(DEMO_PDF)).arrayBuffer())

  const session: StaffSession = { kind: 'staff', sessionId: 'perf-probe', staffId, role: 'clinician', orgId: ORG, orgName: 'Ganga Valley Hospital', staffName: 'Perf Probe', email: PROBE_EMAIL }
  const body: RegisterBody = {
    fullName: hero.fullName, aliases: hero.aliases.filter((a) => a !== hero.fullName).map((name) => ({ name, kind: 'transliteration' as const })),
    dob: hero.dob, sex: hero.sex, phone: freshPhone(), preferredLanguage: hero.preferredLanguage, disclosureStatus: 'unknown', primaryContact: 'patient',
    ...(hero.caregiver ? { caregiver: { name: hero.caregiver.name, relation: hero.caregiver.relation, phone: freshPhone(), isGuardian: false } } : {}),
    consent: {
      purposes: { store: true, ai: true, share: true, abdm: false, metrics: true }, language: hero.preferredLanguage, noticeVersion: CONSENT_NOTICE_VERSION,
      confirm: { method: 'witnessed', attest: true },
    },
    continueDespiteDuplicates: true,
  }
  const reg = await withOrg(ORG, (tx) => {
    const audit: AuditFn = async (action, targetType, targetId, details) => { await writeAudit(tx, { orgId: ORG, actorId: staffId, actorRole: 'clinician', action, targetType, targetId, details }) }
    return registerPatient({ session, body, db: tx, audit } as unknown as StaffCtx<RegisterBody>) // it reads only these four fields of the route context
  })
  if (!('id' in reg)) throw new Error('probe patient registration was refused')
  const patientId = reg.id as string

  const up = await withOrg(ORG, (tx) => ingestDocument(tx, { orgId: ORG, patientId, uploadedBy: { kind: 'staff', id: staffId }, intakeRoute: 'bulk', fileName: DEMO_PDF, bytes: pdf }))
  await runDocument(up.documentId, ORG) // no transaction is open here, so the pipeline's own short ones are fine

  await withOrg(ORG, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, up.documentId))
    const [page1] = await tx.select({ text: documentPages.text }).from(documentPages).where(and(eq(documentPages.documentId, up.documentId), eq(documentPages.pageNo, 1), isNull(documentPages.supersededAt)))
    if (!['done', 'needs_review'].includes(doc.status) || !page1 || page1.text.length < 300) throw new Error(`probe document did not process (status ${doc.status})`)
    const rows = Array.from({ length: MIN_ITEMS }, (_, i) => {
      const type = TYPES[i % TYPES.length]
      return { id: uuidv7(), type, day: new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), fields: fieldsFor(type, `PERF-${String(i + 1).padStart(4, '0')}`) }
    })
    for (let at = 0; at < rows.length; at += 250) {
      const chunk = rows.slice(at, at + 250)
      await tx.insert(events).values(chunk.map((e) => ({
        id: e.id, orgId: ORG, patientId, documentId: doc.id, eventType: e.type, fields: e.fields, eventDate: e.day, datePrecision: 'day' as const,
        receivedAt: doc.receivedAt, sourceType: 'external_document' as const, extractionMethod: 'text_layer' as const, createdByKind: 'system' as const,
      })))
      await tx.insert(evidence).values(chunk.map((e, k) => {
        const charStart = ((at + k) * 7) % (page1.text.length - 140), charEnd = charStart + 40 + ((at + k) % 80)
        const quote = page1.text.slice(charStart, charEnd)
        return { orgId: ORG, patientId, eventId: e.id, documentId: doc.id, pageNo: 1, charStart, charEnd, quote, quoteSha256: sha256Hex(quote) }
      }))
    }
  })
  return patientId
}

type Run = { status: number; ttfbMs: number; totalMs: number; bytes: number; items: number; error?: string }

/** One GET of the ledger page on this deployment with its own short-lived session; times first byte and full body like a browser's responseStart/responseEnd. */
const timedLedger = (staffId: string, url: string, headers: Record<string, string>): Promise<Run> => withProbeSession(staffId, async (cookie) => {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { headers: { ...headers, cookie }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(45_000) })
    const ttfbMs = performance.now() - t0
    const html = Buffer.from(await res.arrayBuffer())
    return { status: res.status, ttfbMs, totalMs: performance.now() - t0, bytes: html.length, items: countItems(html.toString('utf8')) }
  } catch (e) {
    return { status: 0, ttfbMs: Number.NaN, totalMs: Number.NaN, bytes: 0, items: 0, error: e instanceof Error ? (e.cause as { code?: string } | undefined)?.code ?? e.name : 'error' }
  }
})

export const GET = route({ auth: 'public' }, async ({ req, requestId }) => {
  if (process.env.PERF_PROBE_ENABLED !== 'true') throw new HttpError(404, 'not_found', 'Not found')
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')

  // The deployment's own address: the production domain (PUBLIC_BASE_URL) when set, else this deployment's URL.
  const via = process.env.PUBLIC_BASE_URL ? 'PUBLIC_BASE_URL' : 'VERCEL_URL'
  const origin = (process.env.PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '')
  if (!origin) throw new HttpError(503, 'not_configured', 'PUBLIC_BASE_URL or VERCEL_URL is required')
  const headers: Record<string, string> = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}
  const region = process.env.VERCEL_REGION ?? 'local'

  // (a) database round trip from this function's region: 10 sequential `select 1` on the app pool (one untimed first, which opens the connection)
  await db.execute(sql`select 1`)
  const rtts: number[] = []
  for (let i = 0; i < 10; i++) {
    const t = performance.now()
    await db.execute(sql`select 1`)
    rtts.push(performance.now() - t)
  }

  // (b) the probe patient: reused when one exists, else built once
  const staffId = await probeStaffId()
  let patientId = await findProbePatient()
  const created = !patientId
  if (!patientId) patientId = await createProbePatient(staffId, origin, headers)

  // (c) the real page over HTTP: 1 warm (cold start, route compile) + 3 timed, each with its own 60 s session
  const url = `${origin}/patients/${patientId}/ledger`
  await timedLedger(staffId, url, headers)
  const runs: Run[] = []
  for (let i = 0; i < 3; i++) runs.push(await timedLedger(staffId, url, headers))

  // (d) the loader alone, inside withOrg, as the page calls it (1 warm + 3 timed)
  const loadOnce = async () => {
    const t = performance.now()
    const v = await withOrg(ORG, (tx) => loadLedger(tx, patientId!, { staffId, role: 'clinician' }, now(ORG)))
    return { ms: performance.now() - t, items: Object.values(v.events).flat().length }
  }
  await loadOnce()
  const loads = [await loadOnce(), await loadOnce(), await loadOnce()]

  const totalMs = median(runs.map((r) => r.totalMs))
  const itemsFound = Math.min(...runs.map((r) => r.items))
  const summary = {
    region, rttMs: r1(median(rtts)), ttfbMs: r1(median(runs.map((r) => r.ttfbMs))), totalMs: r1(totalMs), htmlBytes: runs[runs.length - 1].bytes,
    itemsFound, loaderMs: r1(median(loads.map((l) => l.ms))), budgetMs: BUDGET_MS,
    verdict: verdictFor({ totalMs, itemsFound, httpOk: runs.every((r) => r.status === 200) }),
  }
  const detail = {
    via, patientCreated: created, rttMinMs: r1(Math.min(...rtts)), loaderItems: loads[0].items, loaderRunsMs: loads.map((l) => r1(l.ms)),
    runs: runs.map((r) => ({ status: r.status, ttfbMs: r1(r.ttfbMs), totalMs: r1(r.totalMs), bytes: r.bytes, items: r.items, ...(r.error ? { error: r.error } : {}) })),
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  }
  const [row] = await db.execute<{ id: string }>(sql`insert into perf_probes (region, rtt_ms, ttfb_ms, total_ms, html_bytes, items_found, loader_ms, budget_ms, verdict, detail)
    values (${summary.region}, ${summary.rttMs}, ${nan(summary.ttfbMs)}, ${nan(summary.totalMs)}, ${summary.htmlBytes}, ${summary.itemsFound}, ${summary.loaderMs}, ${summary.budgetMs}, ${summary.verdict}, ${JSON.stringify(detail)}::jsonb)
    returning id`)
  await withOrg(ORG, (tx) => writeAudit(tx, {
    orgId: ORG, actorId: null, actorRole: 'system', action: 'perf_probe.run', targetType: 'perf_probe', targetId: row.id, requestId,
    details: { verdict: summary.verdict, sessions: runs.length + 1, region },
  }))
  return { ok: true, id: row.id, ...summary, detail }
})
