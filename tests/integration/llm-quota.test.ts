// Proves the shared LLM budget (drizzle/0011_llm_quota.sql) holds across concurrent connections — the case that
// matters on serverless, where several instances process documents at once with one free-tier key.
//   npm run test:integration   (needs .env.local)
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 12, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const TEST = 'itest-quota'
afterAll(async () => {
  await owner`delete from llm_calls where provider = ${TEST}`
  await app.end(); await owner.end()
})

const minuteCount = async () => (await owner`select count(*)::int n from llm_calls where at > now() - interval '60 seconds'`)[0].n as number
const dayCount = async () => (await owner`select count(*)::int n from llm_calls
  where at >= (date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles'`)[0].n as number

describe('llm_reserve as oncosetu_app', () => {
  it('cannot read or write llm_calls directly', async () => {
    await expect(app`select * from llm_calls limit 1`).rejects.toMatchObject({ code: '42501' })
    await expect(app`insert into llm_calls (provider, model) values (${TEST}, 'x')`).rejects.toMatchObject({ code: '42501' })
  })

  it('12 concurrent reservations never exceed the per-minute budget', async () => {
    const allow = 3
    const rpm = (await minuteCount()) + allow
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      app`select * from llm_reserve(${TEST}, 'm', ${rpm}, ${1_000_000}, ${60})`.then((r) => r[0] as { call_id: string | null; reason: string | null })))
    const granted = results.filter((r) => r.call_id)
    expect(granted).toHaveLength(allow)
    expect(results.filter((r) => r.reason === 'rpm')).toHaveLength(12 - allow)
  })

  it('enforces the daily budget and settles outcomes', async () => {
    const rpd = await dayCount()
    const [denied] = await app`select * from llm_reserve(${TEST}, 'm', ${1_000_000}, ${rpd}, ${60})`
    expect(denied).toMatchObject({ call_id: null, reason: 'rpd' })
    const [ok] = await app`select * from llm_reserve(${TEST}, 'm', ${1_000_000}, ${rpd + 1}, ${60})`
    expect(ok.call_id).not.toBeNull()
    await app`select llm_settle(${ok.call_id}, 'ok')`
    await app`select llm_settle(${ok.call_id}, 'rate_limited')` // already settled: no change
    const [row] = await owner`select outcome from llm_calls where id = ${ok.call_id}`
    expect(row.outcome).toBe('ok')
  })

  it('a provider 429 starts a cooldown for everyone', async () => {
    await owner`insert into llm_calls (provider, model, outcome, at) values (${TEST}, 'm', 'rate_limited', now() - interval '50 seconds')`
    const [cool] = await app`select * from llm_reserve(${TEST}, 'm', ${1_000_000}, ${1_000_000}, ${60})`
    expect(cool).toMatchObject({ call_id: null, reason: 'cooldown' })
    const [after] = await app`select * from llm_reserve(${TEST}, 'm', ${1_000_000}, ${1_000_000}, ${30})`
    expect(after.call_id).not.toBeNull()
    const [u] = await app`select * from llm_usage(${60})`
    expect(u.cooldown_until).not.toBeNull()
    await owner`delete from llm_calls where provider = ${TEST} and outcome = 'rate_limited'`
  })
})
