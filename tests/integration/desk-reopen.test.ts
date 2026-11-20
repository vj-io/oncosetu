// Decision 19 (DESK-02): the desk may reopen a record only when the patient was verified TODAY (IST). Enforced in
// assertPatientAccess, not just the UI. Synthetic patient on the demo org; needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const pid = randomUUID()
const desk = { kind: 'staff', sessionId: randomUUID(), staffId: randomUUID(), role: 'desk', orgId: ORG_NARMADA_ID, orgName: 'x', staffName: 'Desk Test', email: 'd@test.invalid' } as const

async function reset(startedAt: Date | null, offline = false) {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`delete from encounters where patient_id = ${pid}`
    if (startedAt) await tx`insert into encounters (org_id, patient_id, type, started_at, offline_created) values (${ORG_NARMADA_ID}, ${pid}, 'returning', ${startedAt}, ${offline})`
  })
}
async function tryOpen() {
  const { withOrg } = await import('../../src/db')
  const { assertPatientAccess } = await import('../../src/server/patients')
  return withOrg(ORG_NARMADA_ID, (tx) => assertPatientAccess({ db: tx, session: desk }, pid)).then(() => 'ok', (e) => e.code as string)
}

beforeAll(async () => {
  const { encryptField } = await import('../../src/server/crypto')
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, disclosure_status) values (${pid}, ${ORG_NARMADA_ID}, ${'t-' + pid}, ${encryptField('Reopen Test')}, 'not_cleared')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG_NARMADA_ID}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v2', 'en')`
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`delete from encounters where patient_id = ${pid}`
    await tx`delete from consents where patient_id = ${pid}`
    await tx`delete from patients where id = ${pid}`
  }).catch(() => {})
  await owner.end()
})

describe('desk reopen (decision 19)', () => {
  it('allows a check-in verified earlier today', async () => {
    const { startOfIstDay } = await import('../../src/server/desk-window')
    // just after IST midnight is still "today" unless the test runs in the first seconds of the day
    const t = new Date(Math.max(startOfIstDay(new Date()).getTime() + 1000, Date.now() - 60_000))
    await reset(t)
    expect(await tryOpen()).toBe('ok')
  })
  it('refuses a check-in from yesterday, even under 12 hours old across midnight', async () => {
    const { startOfIstDay } = await import('../../src/server/desk-window')
    await reset(new Date(startOfIstDay(new Date()).getTime() - 60_000))
    expect(await tryOpen()).toBe('verification_required')
  })
  it('refuses with no encounter at all', async () => {
    await reset(null)
    expect(await tryOpen()).toBe('verification_required')
  })
  it('refuses a visit opened offline by a capture device, even today', async () => {
    await reset(new Date(), true)
    expect(await tryOpen()).toBe('verification_required')
  })
})
