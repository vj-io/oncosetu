// POOL RULE: `route()` and pages run inside a `withOrg()` transaction that holds one `db` connection. While one is open,
// never touch the global `db`, call `withOrg()`/`db.transaction()` again, or call a helper that does: that needs a SECOND
// `db` connection, and once every connection (max 5) is a transaction waiting for another, the whole server hangs until
// Postgres' idle-in-transaction timeout. Inside a transaction use the open `tx` (same transaction, and more correct);
// for a read or write on a table WITHOUT RLS that is independent of the request (sessions, otp_challenges, staff,
// organisations, org_settings), use `sideDb`. A write that must survive a rollback of the request (OTP attempt
// counters) must use `sideDb`, never `tx`. Public routes and the start of a request (session lookup, login, the
// document pipeline's own short transactions) hold no transaction, so `db`/`withOrg` are fine there. Never use `adminDb`.
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

export { schema }
export type DB = PostgresJsDatabase<typeof schema> & { $client: Sql }
/** A drizzle transaction. `ctx.db` in route handlers is one of these, with RLS `app.org_id` set. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

type Clients = { app?: DB; admin?: DB; side?: DB }
const g = globalThis as unknown as { __oncosetuDb?: Clients }
const clients: Clients = (g.__oncosetuDb ??= {}) // survives dev HMR

function make(url: string | undefined, name: string, max: number): DB {
  if (!url) throw new Error(`${name} is not set`)
  // Neon pooler = PgBouncer transaction mode → no named prepared statements.
  return drizzle(postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 15 }), { schema })
}

function lazy(key: keyof Clients, build: () => DB): DB {
  return new Proxy({} as DB, {
    get(_t, prop) {
      const c = (clients[key] ??= build())
      const v = Reflect.get(c, prop, c)
      return typeof v === 'function' ? v.bind(c) : v
    },
  })
}

/** App runtime: non-owner role `oncosetu_app` (RLS enforced), pooled. */
export const db: DB = lazy('app', () => make(process.env.DATABASE_URL_APP, 'DATABASE_URL_APP', 5))

/**
 * Own small pool for work done while a transaction already holds a pooled connection: the org clock, and OTP issue/verify.
 * Borrowing a second connection from `db` there deadlocks the app pool once every connection is a transaction waiting
 * for another one (6 parallel uploads froze the server until Postgres' 5 min idle-in-transaction timeout). Only for
 * tables without RLS (org_settings, otp_challenges): this client sets no `app.org_id`. Code on it must never wait for a
 * `db` connection itself (no `db`/`withOrg` inside a `sideDb` callback).
 */
export const sideDb: DB = lazy('side', () => make(process.env.DATABASE_URL_APP, 'DATABASE_URL_APP', 2))

/** Owner role (BYPASSRLS). Only migrations, seed, and system tasks that genuinely cannot run under RLS. */
export const adminDb: DB = lazy('admin', () =>
  make(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL, 'DATABASE_URL_UNPOOLED', 2))

/** Run `fn` in a transaction with `app.org_id` set for RLS. */
export function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`)
    return fn(tx)
  })
}

/** Close pools (scripts/tests). */
export async function closeDb() {
  await Promise.all(Object.values(clients).map((c) => c?.$client.end({ timeout: 5 })))
  delete clients.app
  delete clients.admin
  delete clients.side
}
