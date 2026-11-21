// A staff member changes their own password (src/server/own-password.ts) against the real database: the current password is
// required, wrong guesses count toward the sign-in lock and lock after five, the new password replaces the old one, every
// other live sign-in ends and the current one stays, and shared demo accounts are refused. Ganga org; cleaned up by id.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID as ORG } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const made: string[] = []
const OLD = 'old-password-1234'

async function member(opts: { demo?: boolean } = {}) {
  const { hashPassword } = await import('../../src/server/crypto')
  const id = randomUUID()
  made.push(id)
  await owner`insert into staff (id, org_id, role, name, email, password_hash, is_demo) values (${id}, ${ORG}, 'records', 'Test Password', ${`pw-${id}@ganga.test`}, ${await hashPassword(OLD)}, ${!!opts.demo})`
  const session = async () => {
    const sid = randomUUID()
    await owner`insert into sessions (id, token_hash, kind, staff_id, org_id, expires_at, idle_timeout_s) values (${sid}, ${'t-' + sid}, 'staff', ${id}, ${ORG}, now() + interval '1 hour', 1800)`
    return sid
  }
  const current = await session(), other = await session()
  const s = { kind: 'staff' as const, sessionId: current, staffId: id, role: 'records' as const, orgId: ORG, orgName: 'Ganga', staffName: 'Test Password', email: `pw-${id}@ganga.test` }
  return { id, s, current, other }
}

afterAll(async () => {
  await owner`delete from sessions where staff_id in ${owner(made)}`
  await owner`delete from staff where id in ${owner(made)}`
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('changing your own password', () => {
  it('with the right current password: the new one works, the old one does not, other sign-ins end and this one stays', async () => {
    const { changeOwnPassword } = await import('../../src/server/own-password')
    const { verifyPassword } = await import('../../src/server/crypto')
    const m = await member()
    expect(await changeOwnPassword(m.s, OLD, 'a-new-and-long-password')).toEqual({ ok: true, ended: 1 })
    const [row] = await owner`select password_hash, failed_logins from staff where id = ${m.id}`
    expect(await verifyPassword('a-new-and-long-password', row.password_hash)).toBe(true)
    expect(await verifyPassword(OLD, row.password_hash)).toBe(false)
    const ses = await owner`select id, revoked_at from sessions where staff_id = ${m.id}`
    expect(ses.find((x) => x.id === m.current)!.revoked_at).toBeNull()
    expect(ses.find((x) => x.id === m.other)!.revoked_at).not.toBeNull()
  })

  it('refuses a wrong current password, a short or unchanged new one, and changes nothing', async () => {
    const { changeOwnPassword } = await import('../../src/server/own-password')
    const m = await member()
    expect(await changeOwnPassword(m.s, 'not-the-password', 'a-new-and-long-password')).toMatchObject({ ok: false, code: 'wrong_password', audit: { action: 'auth.password_change_failed' } })
    expect(await changeOwnPassword(m.s, OLD, 'too-short')).toMatchObject({ ok: false, code: 'weak_password' })
    expect(await changeOwnPassword(m.s, OLD, OLD)).toMatchObject({ ok: false, code: 'weak_password' })
    const [row] = await owner`select failed_logins from staff where id = ${m.id}`
    expect(row.failed_logins).toBe(1)
    expect((await owner`select count(*)::int n from sessions where staff_id = ${m.id} and revoked_at is not null`)[0].n).toBe(0)
  })

  it('five wrong guesses lock the account like sign-in does, and a locked account cannot change it', async () => {
    const { changeOwnPassword } = await import('../../src/server/own-password')
    const m = await member()
    for (let i = 0; i < 5; i++) await changeOwnPassword(m.s, `wrong-${i}-password`, 'a-new-and-long-password')
    const [row] = await owner`select failed_logins, locked_until > now() as locked from staff where id = ${m.id}`
    expect(row).toMatchObject({ failed_logins: 5, locked: true })
    expect(await changeOwnPassword(m.s, OLD, 'a-new-and-long-password')).toMatchObject({ ok: false, code: 'locked' })
  })

  it('a shared demo account cannot change its password', async () => {
    const { changeOwnPassword } = await import('../../src/server/own-password')
    const m = await member({ demo: true })
    expect(await changeOwnPassword(m.s, OLD, 'a-new-and-long-password')).toMatchObject({ ok: false, code: 'demo_account' })
  })
})
