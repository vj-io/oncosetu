// FR-ONB-01, strict order: every runner takes the patient's next waiting document in queue order (UUIDv7 ids = upload
// order; each batch is uploaded in backlog order). Waiting = queued, or processing with a stale lock; a document this
// runner already tried is skipped. Runs as oncosetu_app; the owner only cleans up.   npm run test:integration
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const patient = randomUUID()
afterAll(async () => {
  await owner`delete from documents where patient_id = ${patient}`
  await owner`delete from patients where id = ${patient}`
  await app.end(); await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('patient queue order (FR-ONB-01)', () => {
  it('hands out waiting documents oldest first, skipping finished, freshly locked and already-tried ones', async () => {
    const ids = Array.from({ length: 5 }, () => uuidv7()) // increasing, like five uploads in a row
    const [done, first, busy, second, stale] = ids
    await app.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG_GANGA_ID}, true)`
      await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${patient}, ${ORG_GANGA_ID}, ${'t-' + patient}, 'v1.x')`
      const doc = (id: string, status: string, lockedMinutesAgo: number | null) => tx`
        insert into documents (id, org_id, patient_id, status, locked_at, sha256, mime, size_bytes, intake_route, uploaded_by_kind)
        values (${id}, ${ORG_GANGA_ID}, ${patient}, ${status}, ${lockedMinutesAgo === null ? null : tx`now() - make_interval(mins => ${lockedMinutesAgo})`},
                ${id.replace(/-/g, '').padEnd(64, '0')}, 'application/pdf', 1, 'bulk', 'staff')`
      await doc(done, 'done', null)
      await doc(first, 'queued', null)
      await doc(busy, 'processing', 0) // a runner is on it now
      await doc(second, 'queued', null)
      await doc(stale, 'processing', 10) // its runner died: waiting again
    })
    const { withOrg } = await import('../../src/db')
    const { nextWaiting } = await import('../../src/server/pipeline/process')
    const next = (skip: string[]) => withOrg(ORG_GANGA_ID, (tx) => nextWaiting(tx, patient, skip))
    expect(await next([])).toBe(first)
    expect(await next([first])).toBe(second)
    expect(await next([first, second])).toBe(stale)
    expect(await next([first, second, stale])).toBeNull()
  })
})
