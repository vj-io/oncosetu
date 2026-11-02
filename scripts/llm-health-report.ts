// Latest LLM calls recorded by the shared quota (llm_calls): outcome, provider, model, time. No content is ever stored.
//   npx tsx --env-file=.env.local scripts/llm-health-report.ts [rows]
import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 })
  const n = Number(process.argv[2] ?? 10)
  const rows = await sql`select at, provider, model, outcome from llm_calls order by at desc limit ${n}`
  console.table(rows.map((r) => ({ at: new Date(r.at).toISOString().replace('T', ' ').slice(0, 19), provider: r.provider, model: r.model, outcome: r.outcome })))
  const [u] = await sql`select * from llm_usage(60)`
  console.log(`last minute: ${u.last_minute} · today (Pacific day): ${u.today}`)
  await sql.end()
}
main()
