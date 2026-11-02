// Fails if any file in drizzle/ differs from the hash recorded when it was applied (an edited, already-applied migration).
// Run: npx tsx --env-file=.env.local scripts/check-migrations.mts
import postgres from 'postgres'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { prepare: false })
const rows = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries
for (const [i, e] of journal.entries()) {
  const h = createHash('sha256').update(readFileSync(`drizzle/${e.tag}.sql`, 'utf8')).digest('hex')
  const s = rows[i] ? (rows[i].hash === h ? "match" : "DIFF") : "not-applied"; console.log(e.tag, s); if (s === "DIFF") process.exitCode = 1
}
await sql.end()
