// The patient portal against the real database: "Papers you sent" lists every upload by that person with what became of
// it (held, not filed and quarantined ones included; someone else's never), and "Ask the clinic for a copy" puts one open
// request on a paper the patient cannot open, audited, listed for records staff until a person marks it given.
// Synthetic data on a demo org; needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID(), other = randomUUID(), caregiver = randomUUID()
const doc: Record<string, string> = {}
const patientSession = { kind: 'patient' as const, sessionId: randomUUID(), patientId: pid, orgId: ORG, displayName: 'Test' }
const staffSession = { kind: 'staff', sessionId: randomUUID(), staffId: randomUUID(), role: 'records', orgId: ORG, orgName: 'x', staffName: 'Records Test', email: 'r@test.invalid' } as const

const imp = async () => ({
  db: await import('../../src/db'), crypto: await import('../../src/server/crypto'), audit: await import('../../src/server/audit'),
  copies: await import('../../src/server/portal/copies'), sent: await import('../../src/server/portal/sent'),
})
type C = Awaited<ReturnType<typeof imp>>
const ctx = <S extends { kind: string }>(c: C, tx: import('../../src/db').Tx, session: S, actorId: string, role: string) => ({
  db: tx, session, audit: async (action: string, tt: string | null, tid: string | null, details?: import('../../src/server/audit').AuditDetails) => {
    await c.audit.writeAudit(tx, { orgId: ORG, actorId, actorRole: role, action, targetType: tt, targetId: tid, details })
  },
})
const audits = async (id: string, action: string) => Number((await owner`select count(*)::int as n from audit_log where target_id = ${id} and action = ${action}`)[0].n)

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    for (const p of [pid, other]) {
      await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, sex, disclosure_status) values (${p}, ${ORG}, ${'t-' + p}, ${c.crypto.encryptField('Copy Request Test')}, 'female', 'unknown')`
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${p}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    }
    const add = async (key: string, o: { patient?: string; by: 'staff' | 'patient' | 'caregiver'; byId?: string; attach: string; status: string; name?: string; mime?: string }) => {
      const [r] = await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, uploaded_by_id, attach_state, status, doc_type, filename_enc)
        values (${ORG}, ${o.patient ?? pid}, ${randomUUID()}, ${o.mime ?? 'application/pdf'}, 1, ${o.by === 'staff' ? 'desk_capture' : 'patient_link'}, ${o.by}, ${o.byId ?? (o.by === 'patient' ? pid : o.by === 'caregiver' ? caregiver : null)},
          ${o.attach}, ${o.status}, 'lab_report', ${o.name ? c.crypto.encryptField(o.name) : null}) returning id`
      doc[key] = r.id
    }
    await add('staffDoc', { by: 'staff', attach: 'attached', status: 'done' })
    await add('ownFiled', { by: 'patient', attach: 'auto', status: 'done', name: 'blood test march.pdf' })
    await add('ownHeld', { by: 'patient', attach: 'pending_decision', status: 'needs_review', name: 'scan.pdf' })
    await add('ownRejected', { by: 'patient', attach: 'rejected', status: 'done', name: 'old letter.pdf' })
    await add('ownBlocked', { by: 'patient', attach: 'pending_decision', status: 'quarantined', name: 'file.pdf' })
    await add('ownStudy', { by: 'patient', attach: 'auto', status: 'done', name: 'cd.zip', mime: 'application/x-dicom-study' })
    await add('caregiverDoc', { by: 'caregiver', attach: 'auto', status: 'done', name: 'from son.pdf' })
    await add('otherPatient', { patient: other, by: 'staff', attach: 'attached', status: 'done' })
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const p of [pid, other]) for (const t of ['documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${p}'`)
    for (const p of [pid, other]) await tx`delete from patients where id = ${p}`
  }).catch(() => {})
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('Papers you sent', () => {
  it("lists every upload by this person with what became of it; never a staff upload or someone else's", async () => {
    const c = await imp()
    const rows = await c.db.withOrg(ORG, (tx) => c.sent.loadSentPapers(tx, patientSession))
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(Object.keys(by).sort()).toEqual([doc.ownFiled, doc.ownHeld, doc.ownRejected, doc.ownBlocked, doc.ownStudy].sort())
    expect([by[doc.ownFiled].state, by[doc.ownHeld].state, by[doc.ownRejected].state, by[doc.ownBlocked].state]).toEqual(['filed', 'checking', 'not_filed', 'blocked'])
    expect(by[doc.ownFiled]).toMatchObject({ name: 'blood test march.pdf', open: true })
    expect(by[doc.ownRejected].open).toBe(true) // their own file, though not filed
    expect(by[doc.ownBlocked].open).toBe(false) // quarantined: never opened
    expect(by[doc.ownStudy].open).toBe(false) // a scan study is shown by the clinic's viewer, not as a file
    // The caregiver sees only the caregiver's own upload.
    const theirs = await c.db.withOrg(ORG, (tx) => c.sent.loadSentPapers(tx, { ...patientSession, kind: 'caregiver', caregiverId: caregiver }))
    expect(theirs.map((r) => r.id)).toEqual([doc.caregiverDoc])
  })
})

describe('Ask the clinic for a copy', () => {
  it('one open request per paper, audited once; records staff see it with a 72-hour deadline until it is given', async () => {
    const c = await imp()
    const ask = (id: string) => c.db.withOrg(ORG, (tx) => c.copies.requestCopy(ctx(c, tx, patientSession, pid, 'patient'), id))
    const first = await ask(doc.staffDoc)
    const again = await ask(doc.staffDoc)
    expect(again.at).toBe(first.at) // asking again while it is open changes nothing
    expect(await audits(doc.staffDoc, 'document.copy_requested')).toBe(1)

    const list = await c.db.withOrg(ORG, (tx) => c.copies.loadCopyRequests(tx, new Date()))
    const mine = list.rows.find((r) => r.documentId === doc.staffDoc)!
    expect(mine).toMatchObject({ patientId: pid, name: 'Copy Request Test', overdue: false })
    expect(Date.parse(mine.dueAt) - Date.parse(mine.askedAt)).toBe(72 * 3_600_000)
    const later = await c.db.withOrg(ORG, (tx) => c.copies.loadCopyRequests(tx, new Date(Date.now() + 73 * 3_600_000)))
    expect(later.rows.find((r) => r.documentId === doc.staffDoc)!.overdue).toBe(true)

    const give = () => c.db.withOrg(ORG, (tx) => c.copies.giveCopy(ctx(c, tx, staffSession, staffSession.staffId, 'records'), doc.staffDoc))
    await give()
    await expect(give()).rejects.toMatchObject({ code: 'no_open_request' })
    expect(await audits(doc.staffDoc, 'document.copy_given')).toBe(1)
    const after = await c.db.withOrg(ORG, (tx) => c.copies.loadCopyRequests(tx, new Date()))
    expect(after.rows.some((r) => r.documentId === doc.staffDoc)).toBe(false)
    // Given: the patient may ask again later, which opens a new request.
    expect((await ask(doc.staffDoc)).at).not.toBe(first.at)
  })
  it('refuses a paper they can already open, one held or not theirs, uniformly', async () => {
    const c = await imp()
    const ask = (id: string) => c.db.withOrg(ORG, (tx) => c.copies.requestCopy(ctx(c, tx, patientSession, pid, 'patient'), id))
    await expect(ask(doc.ownFiled)).rejects.toMatchObject({ code: 'already_open' })
    for (const id of [doc.ownHeld, doc.ownRejected, doc.otherPatient]) await expect(ask(id)).rejects.toMatchObject({ status: 404 })
  })
})
