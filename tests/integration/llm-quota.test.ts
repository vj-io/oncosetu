// Proves the shared LLM budget (drizzle/0011_llm_quota.sql) holds across concurrent connections — the case that
// matters on serverless, where several instances process documents at once with one free-tier key — and the per-org
// daily call and token budget for every provider (drizzle/0019, PRD §9.6), as the code calls them (6-argument llm_reserve).
//   npm run test:integration   (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 12, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const TEST = 'itest-quota'
const PAID = 'itest-paid'
const ORG_A = randomUUID(), ORG_B = randomUUID() // throwaway orgs, so a budget of 2 calls is not shared with anything else
beforeAll(async () => {
  for (const id of [ORG_A, ORG_B]) {
    await owner`insert into organisations (id, slug, name) values (${id}, ${'itest-' + id.slice(0, 8)}, 'Quota test org')`
    await owner`insert into org_settings (org_id, llm_daily_calls, llm_daily_tokens) values (${id}, 2, 1000)`
  }
})
afterAll(async () => {
  await owner`delete from llm_calls where provider in (${TEST}, ${PAID}) or org_id in (${ORG_A}, ${ORG_B})`
  await owner`delete from org_settings where org_id in (${ORG_A}, ${ORG_B})`
  await owner`delete from organisations where id in (${ORG_A}, ${ORG_B})`
  await app.end(); await owner.end()
})

const minuteCount = async () => (await owner`select count(*)::int n from llm_calls where provider = ${TEST} and at > now() - interval '60 seconds'`)[0].n as number
const dayCount = async () => (await owner`select count(*)::int n from llm_calls where provider = ${TEST}
  and at >= (date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles'`)[0].n as number
type Slot = { call_id: string | null; reason: string | null }
/** Free-tier call: shared per-minute / per-day budget and cooldown; `org` adds that org's daily budget. */
const reserveShared = (rpm: number, rpd: number, cooldownS = 60, org: string | null = null) =>
  app`select * from llm_reserve(${TEST}, 'm', ${rpm}::int, ${rpd}::int, ${cooldownS}, ${org}::uuid)`.then((r) => r[0] as Slot)
/** Paid provider bound to an org: the org's budget only. */
const reservePaid = (org: string | null) => app`select * from llm_reserve(${PAID}, 'm', ${null}::int, ${null}::int, 60, ${org}::uuid)`.then((r) => r[0] as Slot)

describe('llm_reserve as oncosetu_app', () => {
  it('cannot read or write llm_calls directly', async () => {
    await expect(app`select * from llm_calls limit 1`).rejects.toMatchObject({ code: '42501' })
    await expect(app`insert into llm_calls (provider, model) values (${TEST}, 'x')`).rejects.toMatchObject({ code: '42501' })
  })

  it('12 concurrent reservations never exceed the per-minute budget', async () => {
    const allow = 3
    const rpm = (await minuteCount()) + allow
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveShared(rpm, 1_000_000)))
    const granted = results.filter((r) => r.call_id)
    expect(granted).toHaveLength(allow)
    expect(results.filter((r) => r.reason === 'rpm')).toHaveLength(12 - allow)
  })

  it('enforces the daily budget and settles outcomes', async () => {
    const rpd = await dayCount()
    expect(await reserveShared(1_000_000, rpd)).toMatchObject({ call_id: null, reason: 'rpd' })
    const ok = await reserveShared(1_000_000, rpd + 1)
    expect(ok.call_id).not.toBeNull()
    await app`select llm_settle(${ok.call_id}, 'ok', ${null}::int)`
    await app`select llm_settle(${ok.call_id}, 'rate_limited', ${null}::int)` // already settled: no change
    const [row] = await owner`select outcome from llm_calls where id = ${ok.call_id}`
    expect(row.outcome).toBe('ok')
  })

  it('a provider 429 starts a cooldown for everyone on that provider, and only that provider', async () => {
    await owner`insert into llm_calls (provider, model, outcome, at) values (${TEST}, 'm', 'rate_limited', now() - interval '50 seconds')`
    expect(await reserveShared(1_000_000, 1_000_000, 60)).toMatchObject({ call_id: null, reason: 'cooldown' })
    expect((await reserveShared(1_000_000, 1_000_000, 30)).call_id).not.toBeNull()
    const [u] = await app`select * from llm_usage(${60})`
    expect(u.cooldown_until).not.toBeNull()
    expect((await reservePaid(null)).call_id).not.toBeNull() // a paid provider has no shared budget and no cooldown
    await owner`delete from llm_calls where provider = ${TEST} and outcome = 'rate_limited'`
  })
})

describe('per-org daily budget (PRD §9.6, every provider)', () => {
  it('stops an org at its daily call limit; other orgs and the shared budget are untouched', async () => {
    const a1 = await reservePaid(ORG_A), a2 = await reserveShared(1_000_000, 1_000_000, 60, ORG_A)
    expect([a1.call_id, a2.call_id].every(Boolean)).toBe(true)
    expect(await reservePaid(ORG_A)).toMatchObject({ call_id: null, reason: 'org_calls' })
    expect(await reserveShared(1_000_000, 1_000_000, 60, ORG_A)).toMatchObject({ call_id: null, reason: 'org_calls' })
    expect((await reservePaid(ORG_B)).call_id).not.toBeNull()
    const [row] = await owner`select org_id from llm_calls where id = ${a1.call_id}`
    expect(row.org_id).toBe(ORG_A)
  })

  it('stops an org once the tokens settled today reach its token limit, and reports its use to that org only', async () => {
    await owner`update org_settings set llm_daily_calls = 100 where org_id = ${ORG_B}`
    const b = await reservePaid(ORG_B) // ORG_B used 1 call in the test above
    await app`select llm_settle(${b.call_id}, 'ok', ${1000}::int)`
    expect(await reservePaid(ORG_B)).toMatchObject({ call_id: null, reason: 'org_tokens' })
    const usage = (org: string | null) => app.begin(async (tx) => {
      if (org) await tx`select set_config('app.org_id', ${org}, true)`
      return (await tx`select * from llm_org_usage()`)[0]
    })
    expect(await usage(ORG_B)).toMatchObject({ calls: 2, tokens: '1000' })
    expect(await usage(ORG_A)).toMatchObject({ calls: 2, tokens: '0' })
    expect(await usage(null)).toMatchObject({ calls: 0, tokens: '0' }) // no org set: nothing
    await owner`update org_settings set llm_daily_tokens = 5000 where org_id = ${ORG_B}` // the admin raises the limit
    expect((await reservePaid(ORG_B)).call_id).not.toBeNull()
  })

  it('an org with no settings row gets the generous defaults', async () => {
    const [{ id }] = await owner`insert into organisations (slug, name) values (${'itest-' + randomUUID().slice(0, 8)}, 'No settings') returning id`
    try {
      expect((await reservePaid(id)).call_id).not.toBeNull()
    } finally {
      await owner`delete from llm_calls where org_id = ${id}`
      await owner`delete from organisations where id = ${id}`
    }
  })
})
