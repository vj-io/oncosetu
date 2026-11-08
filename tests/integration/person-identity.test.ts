// FR-ID-07 at the DATABASE level (drizzle/0019): the same ABHA in two orgs is one person (one person_identities row
// both patient rows link to), each org still sees only its own patient row (RLS), and the app role learns nothing but
// a yes/no from person_registered_elsewhere(). Unlinking (erasure) removes the blind index with the last record.
// Runs as oncosetu_app; the owner only reads and cleans up.   npm run test:integration (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const made: string[] = []
afterAll(async () => {
  await owner`delete from patients where id in ${owner(made)}`
  await owner`delete from person_identities pi where not exists (select 1 from patients p where p.person_id = pi.id) and abha_hmac like 'itest-%'`
  await app.end(); await owner.end()
})

const asApp = <T>(org: string, fn: (tx: TransactionSql) => Promise<T>) =>
  app.begin(async (tx) => { await tx`select set_config('app.org_id', ${org}, true)`; return fn(tx) }) as Promise<T>
async function patient(org: string, abhaHmac: string | null) {
  const id = randomUUID()
  made.push(id)
  await asApp(org, (tx) => tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, abha_hmac) values (${id}, ${org}, ${'t-' + id}, 'v1.x', ${abhaHmac})`)
  return id
}
const elsewhere = (org: string, id: string) => asApp(org, async (tx) => (await tx`select person_registered_elsewhere(${id}) as b`)[0].b as boolean)
const personOf = async (id: string) => (await owner`select person_id from patients where id = ${id}`)[0].person_id as string | null
const identities = async (h: string) => (await owner`select id from person_identities where abha_hmac = ${h}`).map((r) => r.id as string)

describe('cross-org person identity (FR-ID-07)', () => {
  it('links both orgs\' records of one ABHA to one person, and tells each org only "registered elsewhere: yes/no"', async () => {
    const h = `itest-${randomUUID()}`
    const ganga = await patient(ORG_GANGA_ID, h)
    expect(await elsewhere(ORG_GANGA_ID, ganga)).toBe(false) // only one org so far
    const narmada = await patient(ORG_NARMADA_ID, h)
    const other = await patient(ORG_GANGA_ID, `itest-${randomUUID()}`)

    const person = await personOf(ganga)
    expect(person).not.toBeNull()
    expect(await personOf(narmada)).toBe(person)
    expect(await identities(h)).toEqual([person])
    expect(await elsewhere(ORG_GANGA_ID, ganga)).toBe(true)
    expect(await elsewhere(ORG_NARMADA_ID, narmada)).toBe(true)
    expect(await elsewhere(ORG_GANGA_ID, other)).toBe(false)
    // A patient of another org cannot be asked about: same answer as "no".
    expect(await elsewhere(ORG_NARMADA_ID, ganga)).toBe(false)
    expect(await elsewhere(ORG_GANGA_ID, narmada)).toBe(false)

    // Each org still sees only its own row, and the app role cannot read the identity table at all.
    expect((await asApp(ORG_GANGA_ID, (tx) => tx`select id from patients where id in (${ganga}, ${narmada})`)).map((r) => r.id)).toEqual([ganga])
    await expect(asApp(ORG_GANGA_ID, (tx) => tx`select * from person_identities limit 1`)).rejects.toMatchObject({ code: '42501' })
    await expect(asApp(ORG_GANGA_ID, (tx) => tx`insert into person_identities (abha_hmac) values ('x')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('a merged or erased record elsewhere no longer counts; the blind index goes with the last linked record', async () => {
    const h = `itest-${randomUUID()}`
    const ganga = await patient(ORG_GANGA_ID, h)
    const narmada = await patient(ORG_NARMADA_ID, h)
    const person = await personOf(ganga)

    await asApp(ORG_NARMADA_ID, (tx) => tx`update patients set status = 'merged' where id = ${narmada}`)
    expect(await elsewhere(ORG_GANGA_ID, ganga)).toBe(false)
    await asApp(ORG_NARMADA_ID, (tx) => tx`update patients set status = 'active' where id = ${narmada}`)
    expect(await elsewhere(ORG_GANGA_ID, ganga)).toBe(true)

    // What erase_patient() does to the identifiers (drizzle/0006): the link is cut, the other org's row keeps the person.
    await asApp(ORG_NARMADA_ID, (tx) => tx`update patients set status = 'erased', abha_hmac = null where id = ${narmada}`)
    expect(await personOf(narmada)).toBeNull()
    expect(await elsewhere(ORG_GANGA_ID, ganga)).toBe(false)
    expect(await identities(h)).toEqual([person])
    await asApp(ORG_GANGA_ID, (tx) => tx`update patients set status = 'erased', abha_hmac = null where id = ${ganga}`)
    expect(await identities(h)).toEqual([]) // no record left: no ABHA-derived value left either
  })

  it('a corrected ABHA moves the record to the other person and drops the orphaned one', async () => {
    const h1 = `itest-${randomUUID()}`, h2 = `itest-${randomUUID()}`
    const p = await patient(ORG_GANGA_ID, h1)
    await asApp(ORG_GANGA_ID, (tx) => tx`update patients set abha_hmac = ${h2} where id = ${p}`)
    expect(await identities(h1)).toEqual([])
    expect(await identities(h2)).toEqual([await personOf(p)])
  })
})
