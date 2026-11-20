// A family makes the request letter for one missing paper (POST /api/p/requests → createPatientLetter): own patient only,
// the hospital comes from the item, one open letter per paper, audited with ids, at most 10 new letters an hour.
// Ganga org, real tables, cleaned up by id.   npm run test:integration (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, withOrg } from '../../src/db'
import { encryptField } from '../../src/server/crypto'
import { ORG_GANGA_ID as ORG } from '../../src/server/demo'
import { HttpError } from '../../src/server/http'
import { writeAudit } from '../../src/server/audit'
import { createPatientLetter, PATIENT_LETTER_LIMIT } from '../../src/server/requests/patient-letter'
import type { PatientSession } from '../../src/server/session'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const made: string[] = []
afterAll(async () => {
  if (made.length) {
    await owner`delete from audit_log where details->>'patientId' in ${owner(made)} and action like 'request.%'`.catch(() => {})
    await owner`delete from record_requests where patient_id in ${owner(made)}`
    await owner`delete from missing_records where patient_id in ${owner(made)}`
    await owner`delete from consents where patient_id in ${owner(made)}`
    await owner`delete from patients where id in ${owner(made)}`
  }
  await owner.end(); await closeDb()
})

const grant = { store: true, ai: false, share: false, abdm: false, metrics: false }
async function patientWithItem(window: Record<string, unknown> = { from: '2026-03-12', to: '2026-05-11' }) {
  const id = randomUUID(), item = randomUUID()
  made.push(id)
  await owner`insert into patients (id, org_id, oncosetu_token_hash, name_enc, disclosure_status) values (${id}, ${ORG}, ${'t-' + id}, ${encryptField('Test Family')}, 'unknown')`
  await owner`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${id}, 'grant', ${owner.json(grant)}, 'staff', 'test', 'en')`
  await owner`insert into missing_records (id, org_id, patient_id, rule_id, rule_version, mode, expected_types, match_window, state, dedupe_key)
    values (${item}, ${ORG}, ${id}, 'RAD-SURG-HPE-01', '1', 'production', ${owner.json(['pathology_report'])}, ${owner.json(window)}, 'expected', ${id + ':k'})`
  const session: PatientSession = { kind: 'patient', sessionId: randomUUID(), patientId: id, orgId: ORG, displayName: 'Test' }
  return { id, item, session }
}
const call = (s: PatientSession, input: { missingId: string; lang: 'en' | 'hi' }) =>
  withOrg(ORG, (tx) => createPatientLetter({ db: tx, session: s, audit: async (action, tt, tid, details) => { await writeAudit(tx, { orgId: ORG, actorId: s.caregiverId ?? s.patientId, actorRole: s.kind, action, targetType: tt, targetId: tid, details }) } }, input))

describe('patient letter (finale decision 1)', () => {
  it('makes the letter for the family’s own paper, once, and audits it with ids only', async () => {
    const a = await patientWithItem()
    const r = await call(a.session, { missingId: a.item, lang: 'hi' })
    expect(r.printUrl).toBe(`/print/request/${r.requestId}?lang=hi`)
    expect(r.existing).toBe(false)
    const [row] = await owner`select patient_id, documents, lang, created_by_kind, letter_payload from record_requests where id = ${r.requestId}`
    expect(row).toMatchObject({ patient_id: a.id, documents: ['pathology_report'], lang: 'hi', created_by_kind: 'patient' })
    expect(row.letter_payload.missingIds).toEqual([a.item])
    const audits = await owner`select details from audit_log where target_id = ${r.requestId} and action = 'request.patient_letter'`
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0].details)).not.toMatch(/Test Family/)
    const again = await call(a.session, { missingId: a.item, lang: 'en' }) // the same paper again opens the same letter
    expect(again).toMatchObject({ requestId: r.requestId, existing: true })
  })

  it('refuses someone else’s paper with the same answer as a paper that does not exist', async () => {
    const a = await patientWithItem(), b = await patientWithItem()
    await expect(call(a.session, { missingId: b.item, lang: 'en' })).rejects.toMatchObject({ status: 404 })
    await expect(call(a.session, { missingId: randomUUID(), lang: 'en' })).rejects.toBeInstanceOf(HttpError)
    expect(await owner`select 1 from record_requests where patient_id in (${a.id}, ${b.id})`).toHaveLength(0)
  })

  it('refuses a paper that is already closed', async () => {
    const a = await patientWithItem()
    await owner`update missing_records set state = 'closed' where id = ${a.item}`
    await expect(call(a.session, { missingId: a.item, lang: 'en' })).rejects.toMatchObject({ status: 409 })
  })

  it('stops at the hourly limit', async () => {
    const a = await patientWithItem()
    for (let i = 0; i < PATIENT_LETTER_LIMIT.perHour; i++) {
      const id = randomUUID()
      await owner`insert into missing_records (id, org_id, patient_id, rule_id, rule_version, mode, expected_types, state, dedupe_key) values (${id}, ${ORG}, ${a.id}, 'RAD-PEND-01', '1', 'production', ${owner.json(['lab_report'])}, 'expected', ${id})`
      await call(a.session, { missingId: id, lang: 'en' })
    }
    await expect(call(a.session, { missingId: a.item, lang: 'en' })).rejects.toMatchObject({ status: 429 })
  }, 120_000)
})
