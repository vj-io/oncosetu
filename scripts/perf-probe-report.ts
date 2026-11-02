// Prints the latest rows of perf_probes (FR-LED-07 production probe, GET /api/cron/perf-probe). Reads the database as the owner role.
//   npx tsx --env-file=.env.local scripts/perf-probe-report.ts [rows=10]
import postgres from 'postgres'

async function main() {
  const rows = Math.min(Math.max(Number(process.argv[2] ?? 10) || 10, 1), 200)
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const r = await sql`select created_at, region, rtt_ms, ttfb_ms, total_ms, html_bytes, items_found, loader_ms, budget_ms, verdict, detail
      from perf_probes order by created_at desc limit ${rows}`
    if (!r.length) return console.log('perf_probes is empty (no probe has run yet)')
    console.table(r.map((x) => ({
      at: x.created_at.toISOString().replace('T', ' ').slice(0, 19), region: x.region, 'db rtt ms': x.rtt_ms, 'ttfb ms': x.ttfb_ms, 'total ms': x.total_ms,
      'html KB': x.html_bytes == null ? null : Math.round(x.html_bytes / 1024), items: x.items_found, 'loader ms': x.loader_ms, budget: x.budget_ms, verdict: x.verdict,
    })))
    const last = r[0]
    console.log(`latest: ${last.verdict.toUpperCase()}, ${last.total_ms ?? 'no timing'} ms of ${last.budget_ms} ms in ${last.region}`)
    console.log('latest detail:', JSON.stringify(last.detail))
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
