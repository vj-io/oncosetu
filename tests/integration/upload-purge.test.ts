// The daily cron (GET /api/cron/inbound-holds) removes the stored pieces of an upload that expired unfinished, and leaves a
// fresh one alone. Called through the route handler itself. Ganga org, cleaned up by id. Needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../src/db'
import { encryptField } from '../../src/server/crypto'
import { ORG_GANGA_ID as ORG } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const pid = randomUUID()
afterAll(async () => {
  await owner`delete from upload_chunks where org_id = ${ORG} and session_id in (select id from upload_sessions where patient_id = ${pid})`
  await owner`delete from upload_sessions where patient_id = ${pid}`
  await owner`delete from patients where id = ${pid}`
  await owner.end(); await closeDb()
})

async function session(expiredHoursAgo: number) {
  const [s] = await owner`insert into upload_sessions (org_id, patient_id, uploader_kind, uploader_id, total_size, total_chunks, sha256, intake_route, expires_at)
    values (${ORG}, ${pid}, 'staff', ${randomUUID()}, 4, 2, ${'0'.repeat(64)}, 'bulk', now() - make_interval(hours => ${expiredHoursAgo})) returning id`
  for (const i of [0, 1]) await owner`insert into upload_chunks (org_id, session_id, idx, bytes_enc, dek_wrapped, size) values (${ORG}, ${s.id}, ${i}, ${Buffer.from('ab')}, 'v1.x', 2)`
  return s.id as string
}

describe('expired unfinished uploads', () => {
  it('the daily cron removes their pieces and marks them aborted; an upload still within its window stays', async () => {
    await owner`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${pid}, ${ORG}, ${'t-' + pid}, ${encryptField('Test Purge')})`
    const old = await session(1), fresh = await session(-3) // fresh expires in 3 hours
    const { GET } = await import('../../src/app/api/cron/inbound-holds/route')
    const res = await GET(new NextRequest('http://localhost/api/cron/inbound-holds', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { expiredUploads: Record<string, number> }).expiredUploads[ORG]).toBeGreaterThanOrEqual(1)
    const left = await owner`select session_id, count(*)::int as n from upload_chunks where session_id in ${owner([old, fresh])} group by 1`
    expect(left.map((r) => [r.session_id, r.n])).toEqual([[fresh, 2]])
    const [s] = await owner`select state from upload_sessions where id = ${old}`
    expect(s.state).toBe('aborted')
  })
})
