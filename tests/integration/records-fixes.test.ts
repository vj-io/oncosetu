// Records audit fixes against the real database: REC-01 (rejected files leave the counts, can be undone), REC-02 (one unreadable
// patient row does not fail the list), REC-04 (one held count on every screen). Synthetic data on the demo orgs; needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID()
const badPid = randomUUID()
const session = { kind: 'staff', sessionId: randomUUID(), staffId: randomUUID(), role: 'records', orgId: ORG, orgName: 'x', staffName: 'Records Test', email: 'r@test.invalid' } as const
const doc: Record<string, string> = {}

const imp = async () => ({
  db: await import('../../src/db'), s: await import('../../src/db/schema'), act: await import('../../src/server/pipeline/actions'),
  q: await import('../../src/server/pipeline/queries'), audit: await import('../../src/server/audit'), crypto: await import('../../src/server/crypto'),
  search: await import('../../src/server/registration/search'), overview: await import('../../src/server/registration/overview'),
  doctor: await import('../../src/server/registration/doctor-overview'), queue: await import('../../src/server/ledger/queue'),
})
const ctxFor = (c: Awaited<ReturnType<typeof imp>>, tx: import('../../src/db').Tx, orgId = ORG) =>
  ({ db: tx, session: { ...session, orgId }, audit: async (action: string, tt: string | null, tid: string | null, details?: import('../../src/server/audit').AuditDetails) => { await c.audit.writeAudit(tx, { orgId, actorId: session.staffId, actorRole: 'records', action, targetType: tt, targetId: tid, details }) } })

// One mixed set: 2 held, and one of every kind that is NOT held.
const MIX: { key: string; attach: string; status: string }[] = [
  { key: 'heldDone', attach: 'pending_decision', status: 'done' },
  { key: 'heldReview', attach: 'pending_decision', status: 'needs_review' },
  { key: 'reading', attach: 'pending_decision', status: 'processing' },
  { key: 'blocked', attach: 'pending_decision', status: 'quarantined' },
  { key: 'rejected', attach: 'rejected', status: 'done' },
  { key: 'detached', attach: 'detached', status: 'done' },
  { key: 'hard', attach: 'attached', status: 'needs_review' },
  { key: 'filed', attach: 'attached', status: 'done' },
]

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${pid}, ${ORG}, ${'t-' + pid}, ${c.crypto.encryptField('Mixed Held Test')}, ${c.crypto.encryptField('1970-01-01')}, 'female', 'cleared')`
    // REC-02: ciphertext written with another key (valid shape, wrong key): decryption fails.
    const corrupt = (v: string) => c.crypto.encryptField(v).slice(0, -6) + 'AAAAAA'
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, phone_enc, sex) values (${badPid}, ${ORG}, ${'t-' + badPid}, ${corrupt('Corrupt Row Test')}, ${corrupt('+91 90000 00000')}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    for (const m of MIX) {
      const [r] = await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, attach_state, status, doc_type, attach_decided_at, attach_reason)
        values (${ORG}, ${pid}, ${randomUUID()}, 'application/pdf', 1, 'desk_capture', 'staff', ${m.attach}, ${m.status}, 'discharge_summary', ${m.attach === 'rejected' ? new Date() : null}, ${m.attach === 'rejected' ? 'Wrong person' : null}) returning id`
      doc[m.key] = r.id
    }
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const p of [pid, badPid]) for (const t of ['documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${p}'`)
    await tx`delete from patients where id = ${pid}`
    await tx`delete from patients where id = ${badPid}`
  }).catch(() => {})
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('REC-04: one held count on every screen', () => {
  it('the Documents page, patient Overview, First look and the records To do all say 2', async () => {
    const c = await imp()
    const listed = await c.db.withOrg(ORG, (tx) => c.q.listDocuments(tx, pid))
    const overview = await c.db.withOrg(ORG, (tx) => c.overview.loadOverview(tx, pid))
    const doctor = await c.db.withOrg(ORG, (tx) => c.doctor.loadDoctorOverview(tx, pid, { ...session, role: 'clinician' }))
    const queue = await c.db.withOrg(ORG, (tx) => c.queue.loadRecordsQueue(tx, 5000))
    const { isHeldRow } = await import('../../src/core/held')
    const heldCounts = {
      documentsPage: listed.rows.filter(isHeldRow).length, documentsProgress: listed.progress.awaitingDecision, overview: overview!.awaitingDecision,
      firstLook: doctor.firstLook.find((r) => r.key === 'held')!.count, todo: queue.rows.find((r) => r.patientId === pid)!.identity,
    }
    expect(heldCounts).toEqual({ documentsPage: 2, documentsProgress: 2, overview: 2, firstLook: 2, todo: 2 })
    expect(overview!.needsReview).toBe(1) // the filed hard-to-read paper is its own number
  })
})

describe('REC-01: reject is undoable and a rejected file is listed apart', () => {
  it('lists who/when/why for a rejected file', async () => {
    const c = await imp()
    const { rows } = await c.db.withOrg(ORG, (tx) => c.q.listDocuments(tx, pid))
    const r = rows.find((x) => x.id === doc.rejected)!
    expect(r.decision).toMatchObject({ reason: 'Wrong person' })
    expect(r.decision!.at).toBeTruthy()
    expect(rows.find((x) => x.id === doc.filed)!.decision).toBeNull()
  })

  it('undo puts it back in the held group, audited; a second undo is 409, not 500', async () => {
    const c = await imp()
    const undo = (id: string, org = ORG) => c.db.withOrg(org, async (tx) => { const x = ctxFor(c, tx, org); return c.act.undoRejection(x, await c.act.loadDocument(x, id), {}) })
    await expect(undo(doc.filed)).rejects.toMatchObject({ status: 409, code: 'not_rejected' }) // never rejected
    expect(await undo(doc.rejected)).toMatchObject({ ok: true, attachState: 'pending_decision' })
    await expect(undo(doc.rejected)).rejects.toMatchObject({ status: 409, code: 'not_rejected' })
    const row = await c.db.withOrg(ORG, async (tx) => (await tx.select().from(c.s.documents).where(eq(c.s.documents.id, doc.rejected)))[0])
    expect(row).toMatchObject({ attachState: 'pending_decision', attachDecidedBy: null, attachReason: null })
    const audits = await c.db.withOrg(ORG, (tx) => tx.select().from(c.s.auditLog).where(eq(c.s.auditLog.targetId, doc.rejected)))
    expect(audits.filter((a) => a.action === 'document.rejection_undone')).toHaveLength(1)
    const listed = await c.db.withOrg(ORG, (tx) => c.q.listDocuments(tx, pid))
    expect(listed.progress.awaitingDecision).toBe(3) // back in the held group
  })

  it('another organisation cannot see it (404)', async () => {
    const c = await imp()
    await expect(c.db.withOrg(ORG_GANGA_ID, async (tx) => c.act.loadDocument(ctxFor(c, tx, ORG_GANGA_ID), doc.rejected))).rejects.toMatchObject({ status: 404 })
  })
})

describe('REC-02: one unreadable patient row does not fail the list or search', () => {
  it('shows the row, flagged in plain words, and logs only the id and an error code', async () => {
    const c = await imp()
    const logged: string[] = []
    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation((l: unknown) => { logged.push(String(l)) })
    try {
      const all = await c.db.withOrg(ORG, (tx) => c.search.searchPatients(tx, '', 500))
      const bad = all.find((r) => r.id === badPid)!
      expect(bad).toMatchObject({ unreadable: true, name: c.search.UNREADABLE_NAME })
      expect(all.find((r) => r.id === pid)!.name).toBe('Mixed Held Test')
      const byName = await c.db.withOrg(ORG, (tx) => c.search.searchPatients(tx, 'Mixed Held'))
      expect(byName.map((r) => r.id)).toContain(pid)
      const byCode = await c.db.withOrg(ORG, (tx) => c.search.searchPatients(tx, `OS·${badPid.replace(/-/g, '').slice(-6)}`))
      expect(byCode.map((r) => r.id)).toEqual([badPid])
    } finally { spy.mockRestore() }
    const line = logged.find((l) => l.includes(badPid))!
    expect(line).toBeTruthy()
    expect(line).not.toContain('Corrupt Row Test')
    expect(JSON.parse(line)).toMatchObject({ patientId: badPid })
  })
})

describe('REC-02 in the records To do: one unreadable name does not fail the queue', () => {
  it('shows the row with the plain flag and logs only the id and an error code', async () => {
    const c = await imp()
    await owner.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG}, true)`
      await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, attach_state, status, doc_type)
        values (${ORG}, ${badPid}, ${randomUUID()}, 'application/pdf', 1, 'desk_capture', 'staff', 'pending_decision', 'done', 'discharge_summary')`
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${badPid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    })
    const logged: string[] = []
    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation((l: unknown) => { logged.push(String(l)) })
    let queue
    try { queue = await c.db.withOrg(ORG, (tx) => c.queue.loadRecordsQueue(tx, 5000)) } finally { spy.mockRestore() }
    expect(queue.rows.find((r) => r.patientId === badPid)?.name).toBe(c.search.UNREADABLE_NAME)
    expect(queue.rows.find((r) => r.patientId === pid)?.name).toBe('Mixed Held Test')
    const line = logged.find((l) => l.includes(badPid))!
    expect(line).toBeTruthy()
    expect(line).not.toContain('Corrupt Row Test')
  })
})


describe('REC-02 on every list and header that decrypts names', () => {
  it('the duplicate checks skip the unreadable row, the record header flags it, and only the id is logged', async () => {
    const c = await imp()
    const dupAdmin = await import('../../src/server/admin/duplicates')
    const dupDesk = await import('../../src/server/registration/duplicates')
    const patientsMod = await import('../../src/server/patients')
    const logged: string[] = []
    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation((l: unknown) => { logged.push(String(l)) })
    try {
      // Before the fix each of these threw on the first unreadable row, and the admin Duplicates page returned 500.
      const pairs = await c.db.withOrg(ORG, async (tx) => dupAdmin.listDuplicates(tx, ORG, await dupAdmin.listMerges(tx, ORG)))
      expect(pairs.some((p) => [p.a.id, p.b.id].includes(badPid))).toBe(false)
      const hits = await c.db.withOrg(ORG, (tx) => dupDesk.findDuplicates(tx, { name: 'Corrupt Row Test', aliases: [], dob: null, phoneHmac: null, abhaHmac: null, identityHmac: null, mrn: null }))
      expect(hits.map((h) => h.id)).not.toContain(badPid)
      const header = await c.db.withOrg(ORG, (tx) => patientsMod.loadPatient(tx, badPid))
      expect(header).toMatchObject({ id: badPid, name: c.search.UNREADABLE_NAME, initials: '?', phoneMasked: null })
      // An unreadable phone counts as no phone: nobody is reachable by text, so confirmation falls back to in person.
      const contact = await import('../../src/server/registration/contact')
      expect(await c.db.withOrg(ORG, (tx) => contact.primaryContactTarget(tx, badPid))).toBeNull()
      expect(await c.db.withOrg(ORG, (tx) => contact.patientOwnTarget(tx, badPid))).toBeNull()
      expect(await c.db.withOrg(ORG, (tx) => c.overview.loadOverview(tx, badPid))).toBeTruthy() // the patient Overview page
    } finally { spy.mockRestore() }
    const lines = logged.filter((l) => l.includes(badPid))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).not.toContain('Corrupt Row Test')
  })
})
