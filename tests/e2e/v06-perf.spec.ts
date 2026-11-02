// V06-E2E-03 (PRD §13 v0.6, FR-LED-07): a patient with 500 events — the change ledger renders in <= 2 s.
// The volume is inserted as the database owner, shaped like what the pipeline writes (events + one evidence row each, all pointing at one
// real uploaded text-PDF and slicing its real page text). The test is about render volume, not extraction. Ganga only; nothing is cleaned up.
//
// The number only means something on a PRODUCTION build next to its database (Vercel sin1 + Neon Singapore). Against `next dev` React's dev
// rendering is several times slower, and from a laptop every database round trip is ~100 ms (the page needs ~20 in sequence). So:
//   - budget: PERF_LEDGER_BUDGET_MS (default 2000), compared with the median of three `responseEnd - requestStart`;
//   - on a dev server (detected from its HMR client) the timings are printed and attached but only asserted if PERF_LEDGER_BUDGET_MS is set;
//   - the 500 items must always be on the page.
// Away from the database (a laptop), the fixed round-trip cost is measured first on the same patient before the 500 events exist
// (baseline), and the gate is the cost the 500 events add (median render - baseline <= budget). Next to the database (Vercel sin1),
// set PERF_COLOCATED=true and the absolute median render is gated instead, which is FR-LED-07 as written.
// A clean number:  npx next build && npx next start -p 3100   then   BASE_URL=http://localhost:3100 npx playwright test v06-perf --project=main
// (run it alone: other parallel specs share the server and the database).
import { v7 as uuidv7 } from 'uuid'
import { eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { documentPages, documents, events, evidence } from '../../src/db/schema'
import { sha256Hex } from '../../src/server/crypto'
import { registerPatient, uploadAndWait } from './helpers/api'
import { ORG } from './helpers/env'
import { test, expect } from './helpers/fixtures'

const EVENTS = 500
const BUDGET_MS = Number(process.env.PERF_LEDGER_BUDGET_MS ?? 2000)
const TYPES = ['lab_report_documented', 'imaging_report_documented', 'prescription_documented', 'consultation_documented', 'pathology_report_documented'] as const
const fieldsFor = (type: (typeof TYPES)[number], n: string): Record<string, string | string[]> => {
  const institution_name = 'Ganga Valley Hospital'
  switch (type) {
    case 'lab_report_documented': return { test_name: `${n} Complete blood count`, institution_name }
    case 'imaging_report_documented': return { test_name: `${n} CT thorax and abdomen`, institution_name }
    case 'prescription_documented': return { medication_names: [`${n} Paracetamol`, 'Ondansetron'], institution_name }
    case 'consultation_documented': return { doctor_name: 'Dr Test', department_text: `${n} Outpatient clinic`, institution_name }
    case 'pathology_report_documented': return { test_name: `${n} Biopsy`, accession_number: `AC-${n}`, institution_name }
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

test('V06-E2E-03 @perf 500-event patient: the ledger renders in <= 2 s', async ({ staff, ui }) => {
  test.setTimeout(480_000)
  const desk = await staff('desk'), records = await staff('records')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient' }) // consent is part of registration
  const up = await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf') // a real text-layer PDF
  expect(['done', 'needs_review']).toContain(up.doc.status)
  const [doc] = await adminDb.select().from(documents).where(eq(documents.id, up.documentId))
  const [page1] = await adminDb.select({ text: documentPages.text }).from(documentPages).where(eq(documentPages.documentId, up.documentId)).orderBy(documentPages.pageNo)
  expect(page1.text.length).toBeGreaterThan(300)

  // Load the ledger as the clinician: one warm-up (a dev server compiles the route on first use), then three timed loads.
  const page = await ui('clinician')
  const url = `/patients/${p.id}/ledger`
  const load = async () => {
    await page.goto(url, { waitUntil: 'load' })
    // (waitForFunction is blocked by the nonce CSP; poll with evaluate.) The paint entry can lag `load` by a frame.
    for (let i = 0; i < 30 && !(await page.evaluate(() => performance.getEntriesByName('first-contentful-paint').length)); i++) await page.waitForTimeout(100)
    return page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      return {
        ttfb: n.responseStart - n.requestStart, serverRender: n.responseEnd - n.requestStart, domContentLoaded: n.domContentLoadedEventEnd,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, htmlKB: Math.round(n.encodedBodySize / 1024),
      }
    })
  }
  await load()
  const baseRuns = [await load(), await load(), await load()]
  const baseline = median(baseRuns.map((r) => r.serverRender))

  // 500 events, each a distinct (type, date, fields) so none is suppressed as a duplicate, each quoting a real slice of page 1.
  const evRows = Array.from({ length: EVENTS }, (_, i) => {
    const type = TYPES[i % TYPES.length]
    const day = new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
    const n = `PERF-${String(i + 1).padStart(4, '0')}`
    return { id: uuidv7(), type, day, fields: fieldsFor(type, n) }
  })
  await adminDb.transaction(async (tx) => {
    for (let at = 0; at < EVENTS; at += 250) {
      const chunk = evRows.slice(at, at + 250)
      await tx.insert(events).values(chunk.map((e) => ({
        id: e.id, orgId: ORG, patientId: p.id, documentId: doc.id, eventType: e.type, fields: e.fields, eventDate: e.day, datePrecision: 'day' as const,
        receivedAt: doc.receivedAt, sourceType: 'external_document' as const, extractionMethod: 'text_layer' as const, createdByKind: 'system' as const,
      })))
      await tx.insert(evidence).values(chunk.map((e, k) => {
        const charStart = ((at + k) * 7) % (page1.text.length - 140), charEnd = charStart + 40 + ((at + k) % 80)
        const quote = page1.text.slice(charStart, charEnd)
        return { orgId: ORG, patientId: p.id, eventId: e.id, documentId: doc.id, pageNo: 1, charStart, charEnd, quote, quoteSha256: sha256Hex(quote) }
      }))
    }
  })

  await load()
  const runs = [await load(), await load(), await load()]
  const render = median(runs.map((r) => r.serverRender))
  const dev = (await page.content()).includes('hmr-client')
  const enforced = !dev || process.env.PERF_LEDGER_BUDGET_MS !== undefined
  const colocated = process.env.PERF_COLOCATED === 'true'
  const added = render - baseline
  const ms = (n: number | null) => n && Math.round(n)
  const summary = {
    server: dev ? 'next dev' : 'production build', events: EVENTS, budgetMs: BUDGET_MS, enforced, colocated, medianServerRenderMs: Math.round(render),
    baselineRenderMs: Math.round(baseline), addedBy500EventsMs: Math.round(added),
    runs: runs.map((r) => ({ ttfb: ms(r.ttfb), serverRender: ms(r.serverRender), domContentLoaded: ms(r.domContentLoaded), fcp: ms(r.fcp), htmlKB: r.htmlKB })),
  }
  console.log(`V06-E2E-03 ${JSON.stringify(summary)}`)
  await test.info().attach('ledger-timing.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' })

  // All 500 events are on the page (the ledger has no pagination), each with its source quote.
  await expect(page.locator('article').filter({ hasText: 'PERF-' })).toHaveCount(EVENTS)
  expect(await page.locator('article').filter({ hasText: 'PERF-' }).filter({ hasText: 'Open source' }).count()).toBe(EVENTS)
  expect(runs.every((r) => r.fcp !== null), 'first contentful paint was recorded').toBe(true)
  if (enforced && colocated) expect(render, `server render (responseEnd - requestStart), median of 3: ${summary.runs.map((r) => r.serverRender).join(', ')} ms, budget ${BUDGET_MS} ms`).toBeLessThanOrEqual(BUDGET_MS)
  else if (enforced) expect(added, `500 events add ${Math.round(added)} ms over the ${Math.round(baseline)} ms baseline of round trips to a remote database; budget ${BUDGET_MS} ms`).toBeLessThanOrEqual(BUDGET_MS)
  else test.info().annotations.push({ type: 'not enforced', description: `next dev: ${Math.round(render)} ms against a ${BUDGET_MS} ms budget; run against a production build to enforce it` })
})
