// Apply drizzle/ migrations as the owner, then (first run only) set the app role's password and append
// DATABASE_URL_APP (pooled, role oncosetu_app) to .env.local. Never prints secrets.
//   npx tsx --env-file=.env.local scripts/migrate.ts
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function main() {
  const owner = process.env.DATABASE_URL_UNPOOLED
  const pooled = process.env.DATABASE_URL
  if (!owner || !pooled) throw new Error('DATABASE_URL_UNPOOLED and DATABASE_URL are required')
  const client = postgres(owner, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' })
    console.log('migrations applied')
    if (process.env.DATABASE_URL_APP) {
      console.log('DATABASE_URL_APP already set; app role password unchanged')
      return
    }
    const pw = randomBytes(24).toString('base64url') // [A-Za-z0-9_-] only: safe inside the SQL literal
    await client.unsafe(`alter role oncosetu_app with login password '${pw}'`)
    const u = new URL(pooled)
    u.username = 'oncosetu_app'
    u.password = pw
    appendFileSync('.env.local', `\nDATABASE_URL_APP=${u.toString()}\n`)
    console.log('DATABASE_URL_APP appended to .env.local (value not printed)')
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
