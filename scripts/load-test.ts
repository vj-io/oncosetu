/**
 * NFR scalability (PRD §6.8: one department, ≤ 2,000 patients, ≤ 50,000 pages). Seeds a synthetic organisation at that
 * scale on the database of the env it is given, then times the pages staff use most against a running server:
 * name search, the patient list, a ledger, a patient's document board and the org-wide records queue.
 *
 *   npx tsx --env-file=<env of a THROWAWAY branch> scripts/load-test.ts --base http://localhost:3305 --confirm-host <db host prefix>
 *       [--patients 2000] [--pages 50000] [--heavy 2000] [--light-docs 2] [--max-mb 400] [--runs 15] [--measure-only]
 *
 * Seeding clones the richest processed patient already on the branch (its documents, page texts, events and evidence)
 * under synthetic names, so every row is the shape the pipeline writes. OCR word boxes and stored files are not copied
 * (they are not read by these pages). The first --heavy patients get the full pages/patients share (25 at PRD scale);
 * the rest get --light-docs documents, which keeps storage down on a free-tier branch while the org still has every
 * patient. It stops early if the database grows past --max-mb. The report gives the scale reached and the fraction of
 * the target, and says which numbers grow with it. Re-running continues from the patients already seeded.
 * The org, its staff account (records@loadtest.test) and its rows stay on the branch: use a branch you can drop.
 * Writes data/perf/load-test.json.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { adminDb, closeDb } from '../src/db'
import { consents, documentPages, documents, events, evidence, organisations, orgSettings, patients, staff } from '../src/db/schema'
import { CONSENT_NOTICE_VERSION } from '../src/i18n/consent'
import { encryptField, hashPassword, randomToken } from '../src/server/crypto'
import { secretFor, totpFor } from '../tests/e2e/helpers/totp'

const ORG = '0193a000-0000-7000-8000-0000000010ad'
const EMAIL = 'records@loadtest.test'
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('base', 'http://localhost:3000')!
const TARGET = { patients: Number(arg('patients', '2000')), pages: Number(arg('pages', '50000')) }
const MAX_MB = Number(arg('max-mb', '400')), RUNS = Number(arg('runs', '15'))
const HEAVY = Number(arg('heavy', String(TARGET.patients))), LIGHT_DOCS = Number(arg('light-docs', '2'))
const FIRST = ['Asha', 'Bhavna', 'Chitra', 'Deepa', 'Esha', 'Farida', 'Gauri', 'Hema', 'Indu', 'Jaya', 'Kavita', 'Lata', 'Meena', 'Nalini', 'Oindrila', 'Pooja', 'Rekha', 'Sarita', 'Tara', 'Usha', 'Vidya', 'Yamini', 'Arjun', 'Bharat', 'Dev', 'Gopal', 'Harish', 'Imran', 'Kiran', 'Mohan', 'Naveen', 'Prakash', 'Rahul', 'Suresh', 'Vikram']
const LAST = ['Agarwal', 'Bhatt', 'Chauhan', 'Desai', 'Ghosh', 'Iyer', 'Joshi', 'Kulkarni', 'Mehta', 'Nair', 'Pillai', 'Rao', 'Shah', 'Trivedi', 'Verma', 'Yadav', 'Banerjee', 'Kapoor', 'Menon', 'Saxena', 'Reddy', 'Sinha', 'Pandey', 'Mishra', 'Gupta', 'Chopra', 'Das', 'Sen', 'Bose', 'Dutta', 'Naidu', 'Patil', 'Shetty', 'Kamath', 'Hegde', 'Rathore', 'Thakur', 'Malhotra', 'Arora', 'Goel', 'Jain', 'Khanna', 'Luthra', 'Murthy', 'Prasad', 'Qureshi', 'Rastogi', 'Sodhi', 'Tandon', 'Upadhyay', 'Wadhwa', 'Zaveri', 'Bedi', 'Chawla', 'Dhillon', 'Gill', 'Kohli', 'Mann']
const nameOf = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= FIRST.length * LAST.length ? ` ${Math.floor(i / (FIRST.length * LAST.length)) + 1}` : ''}`
const mb = async () => Number((await adminDb.execute(sql`select pg_database_size(current_database()) as b`))[0].b) / 1048576
const inOrg = <T>(org: string, fn: (tx: Parameters<Parameters<typeof adminDb.transaction>[0]>[0]) => Promise<T>) =>
  adminDb.transaction(async (tx) => { await tx.execute(sql`select set_config('app.org_id', ${org}, true)`); return fn(tx) })
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

async function template() {
  const [best] = await adminDb.execute(sql`select d.org_id, d.patient_id, count(p.id)::int as pages from documents d join document_pages p on p.document_id = d.id
    where d.status = 'done' and d.attach_state in ('auto', 'attached') and d.org_id <> ${ORG}
      and exists (select 1 from events e where e.document_id = d.id)
    group by d.org_id, d.patient_id having count(distinct d.id) >= 3 order by count(p.id) desc limit 1`)
  if (!best) throw new Error('no processed patient with 3+ documents to clone on this database')
  const org = String(best.org_id), pid = String(best.patient_id)
  return inOrg(org, async (tx) => {
    const docs = await tx.select().from(documents).where(and(eq(documents.patientId, pid), eq(documents.status, 'done'), inArray(documents.attachState, ['auto', 'attached'])))
    const ids = docs.map((d) => d.id)
    const pages = await tx.select().from(documentPages).where(inArray(documentPages.documentId, ids))
    const evs = await tx.select().from(events).where(inArray(events.documentId, ids))
    const evi = evs.length ? await tx.select().from(evidence).where(inArray(evidence.eventId, evs.map((e) => e.id))) : []
    return { docs, pages, evs, evi }
  })
}

async function seed() {
  const startMb = await mb()
  await adminDb.insert(organisations).values({ id: ORG, slug: 'load-test', name: 'Load Test Hospital (synthetic)' }).onConflictDoNothing()
  await adminDb.insert(orgSettings).values({ orgId: ORG }).onConflictDoNothing()
  const totpSecretEnc = encryptField(secretFor(EMAIL)), passwordHash = await hashPassword(process.env.E2E_PASSWORD ?? 'Demo@2026')
  await adminDb.insert(staff).values({ orgId: ORG, role: 'records', name: 'Load Test Records', email: EMAIL, passwordHash, totpSecretEnc })
    .onConflictDoUpdate({ target: staff.email, set: { passwordHash, totpSecretEnc, failedLogins: 0, lockedUntil: null, active: true } })
  const t = await template()
  const perPatient = Math.max(1, Math.round(TARGET.pages / TARGET.patients))
  // Repeat the template's documents until a patient has ~perPatient pages.
  const plan: typeof t.docs = []
  for (let n = 0, k = 0; n < perPatient; k++) { const d = t.docs[k % t.docs.length]; plan.push(d); n += t.pages.filter((p) => p.documentId === d.id).length || 1 }
  // The owner role is not held back by RLS, so every query names the org explicitly.
  const [{ n: have }] = await inOrg(ORG, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(patients).where(eq(patients.orgId, ORG)))
  console.log(`template: ${t.docs.length} documents, ${t.pages.length} pages, ${t.evs.length} events; ${plan.length} documents per patient; ${have} patients already seeded; db ${startMb.toFixed(0)} MB`)
  let stoppedAt: number | null = null
  for (let i = have; i < TARGET.patients; i += 50) {
    const batch = Array.from({ length: Math.min(50, TARGET.patients - i) }, (_, j) => i + j)
    await inOrg(ORG, async (tx) => {
      const pRows = batch.map((n) => ({ id: randomUUID(), orgId: ORG, oncosetuTokenHash: `load-${randomToken(16)}`, nameEnc: encryptField(nameOf(n)), sex: 'female' as const }))
      await tx.insert(patients).values(pRows)
      await tx.insert(consents).values(pRows.map((p) => ({ orgId: ORG, patientId: p.id, action: 'grant' as const, purposes: { store: true, ai: false, share: true, abdm: false, metrics: false }, actorType: 'staff' as const, method: 'desk_assisted', noticeVersion: CONSENT_NOTICE_VERSION, language: 'en' })))
      const docs: (typeof documents.$inferInsert)[] = [], pages: (typeof documentPages.$inferInsert)[] = [], evs: (typeof events.$inferInsert)[] = [], evi: (typeof evidence.$inferInsert)[] = []
      for (const [k, p] of pRows.entries()) for (const d of batch[k] < HEAVY ? plan : plan.slice(0, LIGHT_DOCS)) {
        const docId = randomUUID()
        docs.push({ ...d, id: docId, orgId: ORG, patientId: p.id, encounterId: null, clientFileId: null, duplicateOf: null, nearDupOf: null, amendmentOf: null, sha256: randomToken(32, 'base64url'), uploadedById: null, attachDecidedBy: null })
        for (const pg of t.pages.filter((x) => x.documentId === d.id)) pages.push({ ...pg, id: randomUUID(), orgId: ORG, patientId: p.id, documentId: docId, words: null })
        for (const e of t.evs.filter((x) => x.documentId === d.id)) {
          const evId = randomUUID()
          evs.push({ ...e, id: evId, orgId: ORG, patientId: p.id, documentId: docId, encounterId: null, supersedesId: null, createdById: null })
          for (const q of t.evi.filter((x) => x.eventId === e.id)) evi.push({ ...q, id: randomUUID(), orgId: ORG, patientId: p.id, eventId: evId, documentId: docId, statementId: null })
        }
      }
      for (const c of chunks(docs, 500)) await tx.insert(documents).values(c)
      for (const c of chunks(pages, 1000)) await tx.insert(documentPages).values(c)
      for (const c of chunks(evs, 1000)) await tx.insert(events).values(c)
      for (const c of chunks(evi, 1000)) await tx.insert(evidence).values(c)
    })
    const now = await mb()
    process.stdout.write(`\rseeded ${i + batch.length}/${TARGET.patients} patients, db ${now.toFixed(0)} MB   `)
    if (now - startMb > MAX_MB) { stoppedAt = i + batch.length; console.log(`\nstopped: the database grew past --max-mb ${MAX_MB}`); break }
  }
  console.log()
  return { startMb, endMb: await mb(), stoppedAt }
}

async function scale() {
  return inOrg(ORG, async (tx) => {
    const one = async (q: ReturnType<typeof sql>) => Number((await tx.execute(q))[0].n)
    return {
      patients: await one(sql`select count(*) as n from patients where org_id = ${ORG}`),
      documents: await one(sql`select count(*) as n from documents where org_id = ${ORG}`),
      pages: await one(sql`select count(*) as n from document_pages where org_id = ${ORG}`),
      events: await one(sql`select count(*) as n from events where org_id = ${ORG}`),
    }
  })
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }

async function measure() {
  const login = await fetch(`${BASE}/api/auth/staff/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: process.env.E2E_PASSWORD ?? 'Demo@2026', totp: totpFor(EMAIL) }) })
  if (!login.ok) throw new Error(`load-test staff login failed: ${login.status}`)
  const cookie = /os_sid=[^;]+/.exec(login.headers.get('set-cookie') ?? '')![0]
  const mine = (offset: number) => inOrg(ORG, (tx) => tx.select({ id: patients.id, nameEnc: patients.nameEnc }).from(patients).where(eq(patients.orgId, ORG)).orderBy(patients.createdAt).limit(1).offset(offset))
  const [p] = await mine(0) // the first patients seeded are the heavy ones
  if (!p) throw new Error('no load-test patients: run without --measure-only first')
  const [other] = await mine(1000).then((r) => (r.length ? r : [p]))
  const { decryptField } = await import('../src/server/crypto')
  const name = decryptField(other.nameEnc) // a name in the middle of the org, found by decrypting every patient
  const targets: Record<string, string> = {
    'name search (/patients?q=, decrypts every name)': `/patients?q=${encodeURIComponent(name)}`,
    'name search API (/api/patients?q=)': `/api/patients?q=${encodeURIComponent(name.split(' ')[1])}`,
    'patient list (/patients)': '/patients',
    'ledger (/patients/[id]/ledger)': `/patients/${p.id}/ledger`,
    'document board (/patients/[id]/documents)': `/patients/${p.id}/documents`,
    'document board API (/api/patients/[id]/documents)': `/api/patients/${p.id}/documents`,
    'records queue (/records, org-wide)': '/records',
  }
  const out: Record<string, { p50: number; p95: number; max: number; bytes: number; runs: number }> = {}
  for (const [label, path] of Object.entries(targets)) {
    const ms: number[] = []
    let bytes = 0
    for (let r = 0; r <= RUNS; r++) {
      const t0 = performance.now()
      const res = await fetch(BASE + path, { headers: { cookie } })
      const body = await res.arrayBuffer()
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
      if (r > 0) ms.push(performance.now() - t0) // the first call warms the route
      bytes = body.byteLength
    }
    out[label] = { p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), max: Math.round(Math.max(...ms)), bytes, runs: ms.length }
    console.log(`${label}: p50 ${out[label].p50} ms, p95 ${out[label].p95} ms (${(bytes / 1024).toFixed(0)} KB)`)
  }
  return out
}

async function main() {
  const host = new URL(process.env.DATABASE_URL_UNPOOLED ?? '').hostname
  const confirm = arg('confirm-host')
  if (!confirm || !host.startsWith(confirm)) throw new Error('pass --confirm-host <the start of DATABASE_URL_UNPOOLED\'s host>: this script writes thousands of rows')
  const seeded = process.argv.includes('--measure-only') ? null : await seed()
  const s = await scale()
  const timings = await measure()
  const fraction = Math.min(s.patients / TARGET.patients, s.pages / TARGET.pages)
  const report = {
    at: new Date().toISOString(), base: BASE, target: TARGET, reached: s, fraction: Math.round(fraction * 1000) / 1000,
    dbMb: seeded && { before: Math.round(seeded.startMb), after: Math.round(seeded.endMb), stoppedEarlyAt: seeded.stoppedAt },
    timingsMs: timings,
    measuredPatient: 'the ledger and document board are timed on a heavy patient (target pages per patient)',
    extrapolation: fraction < 0.999 ? 'Name search and the patient list read or decrypt every patient: they are at full patient count. The records queue aggregates over all pages and events: scale its time linearly from the page fraction. The ledger and document board are per patient and do not grow with the org.' : null,
    note: 'Laptop `next start` against Neon (Singapore, ~100 ms round trip): times are dominated by database round trips and are an upper bound for a co-located deployment.',
  }
  mkdirSync('data/perf', { recursive: true })
  writeFileSync('data/perf/load-test.json', JSON.stringify(report, null, 2) + '\n')
  console.log('wrote data/perf/load-test.json')
}

main().then(closeDb).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDb(); process.exit(1) })
