// NFR-PERF (PRD §6.8): per-page processing p95 (target ≤ 60 s) and 50-page batch time (target ≤ 15 min), read from the
// timestamps the pipeline already writes. Read-only; reads as the owner role, so it covers every organisation.
//   npx tsx --env-file=.env.local scripts/perf-pipeline.ts [--since=2026-11-01]
// A document's time runs from its row being created (upload) to its first `document.processed` audit row; both are real
// time (received_at may run on the demo clock). A batch is one patient's uploads with less than BATCH_GAP between them.
import postgres from 'postgres'

const PAGE_P95_S = 60
const BATCH_PAGES = 50
const BATCH_MIN = 15
const BATCH_GAP_MS = 2 * 60_000

type Doc = { patientId: string; pages: number; createdAt: Date; processedAt: Date }

/** Nearest-rank percentile; null for no data. */
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const sec = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)

function batches(docs: Doc[]) {
  const out: { pages: number; docs: number; ms: number }[] = []
  let cur: Doc[] = []
  const flush = () => {
    if (cur.length) out.push({ pages: cur.reduce((a, d) => a + d.pages, 0), docs: cur.length, ms: Math.max(...cur.map((d) => +d.processedAt)) - +cur[0].createdAt })
    cur = []
  }
  for (const d of docs) { // sorted by patient, then created_at
    const prev = cur.at(-1)
    if (prev && (prev.patientId !== d.patientId || +d.createdAt - +prev.createdAt > BATCH_GAP_MS)) flush()
    cur.push(d)
  }
  flush()
  return out
}

async function main() {
  const since = process.argv.find((a) => a.startsWith('--since='))?.slice(8) ?? '1970-01-01'
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const rows = await sql<{ patient_id: string; pages: number; created_at: Date; processed_at: Date }[]>`
      select d.patient_id, d.pages, d.created_at, p.at as processed_at
      from documents d
      cross join lateral (select min(a.at) as at from audit_log a
        where a.org_id = d.org_id and a.target_type = 'document' and a.target_id = d.id::text and a.action = 'document.processed') p
      where p.at is not null and d.pages > 0 and d.created_at >= ${since}::timestamptz
      order by d.patient_id, d.created_at`
    const docs: Doc[] = rows.map((r) => ({ patientId: r.patient_id, pages: r.pages, createdAt: r.created_at, processedAt: r.processed_at }))
    if (!docs.length) return console.log(`No processed documents since ${since}.`)

    const ms = (d: Doc) => +d.processedAt - +d.createdAt
    const perPage = docs.flatMap((d) => Array<number>(d.pages).fill(ms(d) / d.pages)) // one entry per page
    const single = docs.filter((d) => d.pages === 1).map(ms)
    const p95 = pct(perPage, 95)
    const bs = batches(docs)
    const big = bs.filter((b) => b.pages >= BATCH_PAGES).sort((a, b) => b.ms - a.ms)
    const largest = [...bs].sort((a, b) => b.pages - a.pages)[0]

    console.log(`Documents ${docs.length}, pages ${perPage.length}, since ${since}`)
    console.log(`Per page (document time ÷ pages): median ${sec(pct(perPage, 50))}, p95 ${sec(p95)}, max ${sec(pct(perPage, 100))}  [target p95 ≤ ${PAGE_P95_S} s: ${p95! <= PAGE_P95_S * 1000 ? 'MET' : 'MISSED'}]`)
    console.log(`Single-page documents (${single.length}): median ${sec(pct(single, 50))}, p95 ${sec(pct(single, 95))}`)
    console.log(`Batches (one patient, uploads < ${BATCH_GAP_MS / 60_000} min apart): ${bs.length}; largest ${largest.pages} pages / ${largest.docs} documents in ${sec(largest.ms)}`)
    if (big.length) {
      const worst = big[0]
      console.log(`Batches of ≥ ${BATCH_PAGES} pages: ${big.length}; slowest ${worst.pages} pages in ${(worst.ms / 60_000).toFixed(1)} min  [target ≤ ${BATCH_MIN} min for ${BATCH_PAGES} pages: ${worst.ms <= BATCH_MIN * 60_000 ? 'MET' : 'MISSED'}]`)
    } else console.log(`No batch of ≥ ${BATCH_PAGES} pages yet: the 50-page target is not measured.`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
