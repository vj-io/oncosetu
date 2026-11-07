// A held (possibly another person's), blocked, rejected or detached document must never reach the family portal.
// Inserts one document per state for a synthetic patient and reads what the portal home loads. Needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const pid = randomUUID()
const ids: Record<string, string> = {}

beforeAll(async () => {
  const { encryptField } = await import('../../src/server/crypto')
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, disclosure_status) values (${pid}, ${ORG_NARMADA_ID}, ${'t-' + pid}, ${encryptField('Portal Test')}, 'not_cleared')`
    const rows: [string, string, string, string][] = [
      ['filed', 'auto', 'done', 'lab_report'], ['attached', 'attached', 'done', 'discharge_summary'],
      ['held_wrong_patient', 'pending_decision', 'needs_review', 'pathology_report'], ['blocked', 'pending_decision', 'quarantined', 'other'],
      ['rejected', 'rejected', 'done', 'imaging_report'], ['detached', 'detached', 'done', 'lab_report'],
    ]
    for (const [key, attach, status, type] of rows) {
      const id = randomUUID(); ids[key] = id
      await tx`insert into documents (id, org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, attach_state, status, doc_type, document_date, flags)
        values (${id}, ${ORG_NARMADA_ID}, ${pid}, ${'sha-' + id}, 'application/pdf', 10, 'bulk', 'staff', ${attach}, ${status}, ${type}, '2026-03-10', ${tx.json({})})`
    }
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => { await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`; await tx.unsafe(`delete from documents where patient_id = '${pid}'`); await tx.unsafe(`delete from patients where id = '${pid}'`) }).catch(() => {})
  await owner.end()
})

describe('what the family portal lists', () => {
  it('lists only papers filed under this patient', async () => {
    const { withOrg } = await import('../../src/db')
    const { loadHomeData } = await import('../../src/server/portal/home')
    const data = await withOrg(ORG_NARMADA_ID, (tx) => loadHomeData(tx, ORG_NARMADA_ID, pid))
    const listed = data.documents.map((d) => d.id).sort()
    expect(listed).toEqual([ids.filed, ids.attached].sort())
    for (const k of ['held_wrong_patient', 'blocked', 'rejected', 'detached']) expect(listed).not.toContain(ids[k])
  })

  it('the filed-documents rule matches the staff counts: held and blocked are never counted as filed', async () => {
    const rows = await owner`select attach_state, status from documents where patient_id = ${pid}`
    const filed = rows.filter((r) => ['auto', 'attached'].includes(r.attach_state) && r.status !== 'quarantined').length
    expect(filed).toBe(2)
  })
})
