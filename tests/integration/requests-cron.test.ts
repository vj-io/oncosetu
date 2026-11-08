// FR-REQ-04: the daily requests cron (GET /api/cron/requests → refreshOpenRequests) sends the day-7 reminder with nobody
// opening a request list, once only, and never for a patient whose consent was withdrawn. Ganga org, real tables,
// cleaned up by id.   npm run test:integration (needs .env.local)
import { existsSync } from 'node:fs'
import { randomInt, randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, withOrg } from '../../src/db'
import { encryptField, phoneHmac } from '../../src/server/crypto'
import { ORG_GANGA_ID as ORG } from '../../src/server/demo'
import { refreshOpenRequests } from '../../src/server/requests/requests'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const made: string[] = []
afterAll(async () => {
  if (made.length) {
    await owner`delete from outbox where patient_id in ${owner(made)}`
    await owner`delete from record_requests where patient_id in ${owner(made)}`
    await owner`delete from consents where patient_id in ${owner(made)}`
    await owner`delete from patients where id in ${owner(made)}`
  }
  await app.end(); await owner.end(); await closeDb()
})

const asApp = <T>(fn: (tx: TransactionSql) => Promise<T>) =>
  app.begin(async (tx) => { await tx`select set_config('app.org_id', ${ORG}, true)`; return fn(tx) }) as Promise<T>
const grant = (store: boolean) => ({ store, ai: false, share: false, abdm: false, metrics: false })

/** A patient with their own phone, consent, and a request given to the hospital `days` ago. */
async function withOpenRequest(days: number) {
  const id = randomUUID(), phone = `+91 9${randomInt(1000, 9999)} ${randomInt(10000, 99999)}`
  made.push(id)
  const requestId = await asApp(async (tx) => {
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, phone_enc, phone_hmac) values (${id}, ${ORG}, ${'t-' + id}, 'v1.x', ${encryptField(phone)}, ${phoneHmac(phone)})`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${id}, 'grant', ${tx.json(grant(true))}, 'staff', 'test', 'en')`
    const [r] = await tx`insert into record_requests (org_id, patient_id, institution, created_by_kind, state, sent_at)
      values (${ORG}, ${id}, 'City Hospital', 'staff', 'sent', now() - make_interval(days => ${days})) returning id`
    return r.id as string
  })
  return { id, requestId }
}
const reminders = async (patientId: string) => (await owner`select template_key from outbox where patient_id = ${patientId}`).map((r) => r.template_key)
const request = async (id: string) => (await owner`select state, reminder_7_sent_at from record_requests where id = ${id}`)[0]

describe('requests cron (FR-REQ-04)', () => {
  it('sends the day-7 reminder once, without anyone reading the list, and skips a patient who withdrew consent', async () => {
    const due = await withOpenRequest(8)
    const fresh = await withOpenRequest(2)
    const withdrawn = await withOpenRequest(8)
    await asApp((tx) => tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language)
      values (${ORG}, ${withdrawn.id}, 'withdraw', ${tx.json(grant(false))}, 'patient', 'test', 'en')`) // own transaction: the latest row wins

    await withOrg(ORG, (tx) => refreshOpenRequests(tx, ORG))
    expect(await request(due.requestId)).toMatchObject({ state: 'reminder_due', reminder_7_sent_at: expect.any(Date) })
    expect(await reminders(due.id)).toEqual(['request.reminder7'])
    expect(await request(fresh.requestId)).toMatchObject({ state: 'sent', reminder_7_sent_at: null })
    expect(await reminders(fresh.id)).toEqual([])
    expect(await request(withdrawn.requestId)).toMatchObject({ state: 'sent', reminder_7_sent_at: null })
    expect(await reminders(withdrawn.id)).toEqual([])

    await withOrg(ORG, (tx) => refreshOpenRequests(tx, ORG)) // the next day's run: nothing twice
    expect(await reminders(due.id)).toEqual(['request.reminder7'])
  }, 120_000)
})
