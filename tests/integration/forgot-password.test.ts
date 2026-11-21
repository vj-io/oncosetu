// Forgotten password (src/server/forgot-password.ts) against the real database: the authenticator code sets a new password,
// every sign-in ends, and the code cannot be used twice; a wrong code changes nothing and counts toward the lock; after
// five the account is locked, after DAILY_CODE_FAILURES in a day the reset stays closed; demo, deactivated, unknown and
// authenticator-less accounts all get the same refusal. Ganga org; cleaned up by id.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID as ORG } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const made: string[] = []
const OLD = 'old-password-1234', NEW = 'a-new-and-long-password'
const STEP = 30_000

async function member(opts: { demo?: boolean; active?: boolean; totp?: boolean } = {}) {
  const { encryptField, hashPassword } = await import('../../src/server/crypto')
  const { generateTotpSecret } = await import('../../src/server/totp')
  const id = randomUUID(), email = `fp-${id}@ganga.test`, secret = generateTotpSecret()
  made.push(id)
  await owner`insert into staff (id, org_id, role, name, email, password_hash, totp_secret_enc, totp_enabled, is_demo, active)
    values (${id}, ${ORG}, 'records', 'Test Forgot', ${email}, ${await hashPassword(OLD)}, ${opts.totp === false ? null : encryptField(secret)},
      ${opts.totp !== false}, ${!!opts.demo}, ${opts.active ?? true})`
  for (let i = 0; i < 2; i++) await owner`insert into sessions (id, token_hash, kind, staff_id, org_id, expires_at, idle_timeout_s)
    values (${randomUUID()}, ${'t-' + randomUUID()}, 'staff', ${id}, ${ORG}, now() + interval '1 hour', 1800)`
  return { id, email, secret }
}

const reset = async (email: string, code: string, next = NEW) => {
  const { resetForgottenPassword } = await import('../../src/server/forgot-password')
  try { return await resetForgottenPassword({ email, totp: code, next }, 'req-test') } catch (e) { return e as { status: number; code: string; message: string } }
}
const code = async (secret: string, ms = 0) => (await import('../../src/server/totp')).totp(secret, Date.now() + ms)
const audits = async (id: string, action: string) =>
  owner`select details from audit_log where target_type = 'staff' and target_id = ${id} and action = ${action} order by seq`
const wrong = async (secret: string) => { // a valid-looking code that is not current
  const near = new Set([await code(secret, -STEP), await code(secret), await code(secret, STEP)])
  for (let n = 0; ; n++) { const c = String(n).padStart(6, '0'); if (!near.has(c)) return c }
}

afterAll(async () => {
  await owner`delete from sessions where staff_id in ${owner(made)}`
  await owner`delete from staff where id in ${owner(made)}`
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('resetting a forgotten password with the authenticator code', () => {
  it('sets the new password, ends every sign-in, is audited, and the same code cannot reset it again', async () => {
    const { verifyPassword } = await import('../../src/server/crypto')
    const m = await member()
    const c = await code(m.secret)
    expect(await reset(m.email.toUpperCase(), c)).toEqual({ ended: 2 })
    const [row] = await owner`select password_hash from staff where id = ${m.id}`
    expect(await verifyPassword(NEW, row.password_hash)).toBe(true)
    expect(await verifyPassword(OLD, row.password_hash)).toBe(false)
    expect((await owner`select count(*)::int n from sessions where staff_id = ${m.id} and revoked_at is null`)[0].n).toBe(0)
    expect((await audits(m.id, 'auth.password_reset')).map((r) => r.details)).toEqual([{ ended: 2 }])
    expect(await reset(m.email, c, 'yet-another-long-password')).toMatchObject({ status: 401, code: 'invalid_credentials' }) // replay
  })

  it('a wrong code changes nothing, counts toward the lock, and five lock the account even for the right code', async () => {
    const { verifyPassword } = await import('../../src/server/crypto')
    const m = await member()
    const bad = await wrong(m.secret)
    expect(await reset(m.email, bad)).toMatchObject({ status: 401, code: 'invalid_credentials' })
    const [row] = await owner`select password_hash, failed_logins from staff where id = ${m.id}`
    expect(row.failed_logins).toBe(1)
    expect(await verifyPassword(OLD, row.password_hash)).toBe(true)
    for (let i = 0; i < 4; i++) await reset(m.email, bad)
    expect((await owner`select locked_until > now() as locked from staff where id = ${m.id}`)[0].locked).toBe(true)
    expect(await reset(m.email, await code(m.secret))).toMatchObject({ status: 401 })
    expect((await audits(m.id, 'auth.password_reset_failed')).at(-1)!.details).toEqual({ reason: 'locked' })
  })

  it(`after DAILY_CODE_FAILURES wrong codes in a day the reset stays closed, even with the lock over`, async () => {
    const { DAILY_CODE_FAILURES } = await import('../../src/server/forgot-password')
    const m = await member()
    const bad = await wrong(m.secret)
    for (let i = 0; i < DAILY_CODE_FAILURES; i++) {
      await reset(m.email, bad)
      await owner`update staff set locked_until = null, failed_logins = 0 where id = ${m.id}`
    }
    expect(await reset(m.email, await code(m.secret))).toMatchObject({ status: 401 })
    expect((await audits(m.id, 'auth.password_reset_failed')).at(-1)!.details).toEqual({ reason: 'daily_limit' })
    expect((await audits(m.id, 'auth.password_reset'))).toHaveLength(0)
  })

  it('demo, deactivated, unknown and authenticator-less accounts all get the same refusal; a short password is refused first', async () => {
    const { demoTotpSecret } = await import('../../src/server/totp')
    const demo = await member({ demo: true }), off = await member({ active: false }), none = await member({ totp: false })
    const generic = { status: 401, code: 'invalid_credentials', message: 'Email or code is incorrect' }
    expect(await reset(demo.email, await code(demo.secret))).toMatchObject(generic)
    expect(await reset(off.email, await code(off.secret))).toMatchObject(generic)
    expect(await reset(none.email, '123456')).toMatchObject(generic)
    expect(await reset(`nobody-${randomUUID()}@ganga.test`, '123456')).toMatchObject(generic)
    // an account whose secret is the public demo secret (seeded E2E accounts) cannot be reset either
    const pub = await member()
    const { encryptField } = await import('../../src/server/crypto')
    await owner`update staff set totp_secret_enc = ${encryptField(demoTotpSecret(pub.email))} where id = ${pub.id}`
    expect(await reset(pub.email, await code(demoTotpSecret(pub.email)))).toMatchObject(generic)
    expect((await audits(pub.id, 'auth.password_reset_failed'))[0].details).toEqual({ reason: 'no_authenticator' })
    expect(await reset(demo.email, await code(demo.secret), 'short')).toMatchObject({ status: 400, code: 'weak_password' })
    for (const m of [demo, off, none, pub]) expect((await owner`select count(*)::int n from sessions where staff_id = ${m.id} and revoked_at is null`)[0].n).toBe(2)
  })
})
