// A clinician changes a patient's name: the name and its duplicate key change, the old name can stay as another name, held
// papers go back to the reading queue, and the change is audited with codes only. Synthetic data on a demo org.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID(), estimated = randomUUID()
const DOB = '1960-01-01'
const session = { kind: 'staff', sessionId: randomUUID(), staffId: randomUUID(), role: 'clinician', orgId: ORG, orgName: 'x', staffName: 'Clinician Test', email: 'c@test.invalid' } as const
const doc: Record<string, string> = {}
const MIX = [
  { key: 'heldDone', attach: 'pending_decision', status: 'done' },
  { key: 'heldReview', attach: 'pending_decision', status: 'needs_review' },
  { key: 'reading', attach: 'pending_decision', status: 'processing' },
  { key: 'blocked', attach: 'pending_decision', status: 'quarantined' },
  { key: 'filed', attach: 'attached', status: 'done' },
] as const

const imp = async () => ({
  db: await import('../../src/db'), crypto: await import('../../src/server/crypto'), audit: await import('../../src/server/audit'),
  admin: await import('../../src/server/registration/patient-admin'), logic: await import('../../src/server/registration/logic'),
})
const rename = async (patientId: string, body: { fullName: string; reason: 'spelling_correction' | 'married_or_legal_change' | 'entered_in_error'; keepPrevious: boolean }) => {
  const c = await imp()
  return c.db.withOrg(ORG, (tx) => c.admin.setPatientName({
    db: tx, session, body,
    audit: async (action: string, tt: string | null, tid: string | null, details?: import('../../src/server/audit').AuditDetails) => {
      await c.audit.writeAudit(tx, { orgId: ORG, actorId: session.staffId, actorRole: 'clinician', action, targetType: tt, targetId: tid, details })
    },
  } as never, patientId))
}

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    // One patient registered with a date of birth (duplicate key set), one with an age only (estimated, key null).
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, identity_hmac, sex) values (${pid}, ${ORG}, ${'t-' + pid}, ${c.crypto.encryptField('Asha Gavde Test')}, ${c.crypto.encryptField(DOB)}, ${c.logic.identityKey('Asha Gavde Test', DOB)}, 'female')`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, identity_hmac, sex) values (${estimated}, ${ORG}, ${'t-' + estimated}, ${c.crypto.encryptField('Usha Kamla Test')}, ${c.crypto.encryptField(DOB)}, ${null}, 'female')`
    for (const p of [pid, estimated]) {
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${p}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    }
    for (const m of MIX) {
      const [r] = await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, attach_state, status, doc_type)
        values (${ORG}, ${pid}, ${randomUUID()}, 'application/pdf', 1, 'desk_capture', 'staff', ${m.attach}, ${m.status}, 'lab_report') returning id`
      doc[m.key] = r.id
    }
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const p of [pid, estimated]) for (const t of ['document_files', 'documents', 'patient_aliases', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${p}'`).catch(() => {})
    for (const p of [pid, estimated]) await tx`delete from patients where id = ${p}`.catch(() => {})
  }).catch(() => {})
  await owner.end()
})

describe('a clinician changes the patient name', () => {
  it('saves the name and duplicate key, keeps the old name as another name, re-queues only held papers, audits codes', async () => {
    const c = await imp()
    const r = await rename(pid, { fullName: '  Asha   Gavade Test ', reason: 'spelling_correction', keepPrevious: true })
    expect(r).toEqual({ ok: true, heldRechecked: 2 })
    const [p] = await owner`select name_enc, identity_hmac from patients where id = ${pid}`
    expect(c.crypto.decryptField(p.name_enc)).toBe('Asha Gavade Test')
    expect(p.identity_hmac).toBe(c.logic.identityKey('Asha Gavade Test', DOB))
    const aliases = await owner`select name_enc, kind, created_by from patient_aliases where patient_id = ${pid}`
    expect(aliases.map((a) => ({ name: c.crypto.decryptField(a.name_enc), kind: a.kind, by: a.created_by }))).toEqual([{ name: 'Asha Gavde Test', kind: 'other', by: session.staffId }])
    const rows = Object.fromEntries((await owner`select id, status, attach_state from documents where patient_id = ${pid}`).map((d) => [d.id, d]))
    // The two held papers left their held state for the reading queue (a runner may already have picked them up).
    for (const k of ['heldDone', 'heldReview'] as const) expect(['queued', 'processing', 'failed']).toContain(rows[doc[k]].status)
    expect(rows[doc.reading].status).toBe('processing')
    expect(rows[doc.blocked].status).toBe('quarantined')
    expect(rows[doc.filed]).toMatchObject({ status: 'done', attach_state: 'attached' })
    const [a] = await owner`select details from audit_log where target_id = ${pid} and action = 'patient.name_changed' order by seq desc limit 1`
    expect(a.details).toEqual({ reason: 'spelling_correction', keptPreviousAsOtherName: true, heldRechecked: 2 })
    expect(JSON.stringify(a.details)).not.toMatch(/Asha|Gavade|Gavde/)
  }, 60_000)

  it('refuses an unchanged name, and adds no other name when told not to', async () => {
    const c = await imp()
    const same = await rename(pid, { fullName: 'Asha Gavade Test', reason: 'spelling_correction', keepPrevious: true })
    expect((same as Response).status).toBe(409)
    await rename(pid, { fullName: 'Asha Gavade', reason: 'entered_in_error', keepPrevious: false })
    const aliases = await owner`select name_enc from patient_aliases where patient_id = ${pid}`
    expect(aliases.map((x) => c.crypto.decryptField(x.name_enc))).toEqual(['Asha Gavde Test'])
  }, 60_000)

  it('keeps the duplicate key empty when the date of birth was estimated from an age', async () => {
    await rename(estimated, { fullName: 'Usha Kamala Test', reason: 'spelling_correction', keepPrevious: true })
    const [p] = await owner`select identity_hmac from patients where id = ${estimated}`
    expect(p.identity_hmac).toBeNull()
  }, 60_000)
})
