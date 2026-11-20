// Processing reliability on real scanned reports (a 16-page scan was run 7 times, MAX_ATTEMPTS being 3): the claim is atomic
// and capped, a live runner renews its lock while OCR runs (so a slow OCR is never taken for a dead runner), and a retry
// resumes at the page after the last one read. OCR is a fake, slow provider.   npm run test:integration
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { sql as sqlTag } from 'drizzle-orm'
import postgres from 'postgres'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'
import type { OcrProvider } from '../../src/server/pipeline/text'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID()
const imp = async () => ({
  db: await import('../../src/db'), s: await import('../../src/db/schema'),
  ingest: await import('../../src/server/pipeline/ingest'), proc: await import('../../src/server/pipeline/process'),
  q: await import('../../src/server/pipeline/queries'), crypto: await import('../../src/server/crypto'),
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${pid}, ${ORG}, ${'t-' + pid}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female', 'cleared')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
}, 60_000)
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const t of ['evidence', 'events', 'missing_records', 'ai_runs', 'document_read_cache', 'document_pages', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
  }).catch(() => {})
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

let seed = 0
/** A scanned PDF: one different image per page, no text layer. Distinct per call, so no upload is a duplicate of another. */
async function scannedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const k = ++seed
  for (let i = 0; i < pages; i++) {
    const png = await sharp({ create: { width: 100 + k * 7 + i, height: 80, channels: 3, background: { r: 255 - k, g: 255 - i, b: 250 } } }).png().toBuffer()
    doc.addPage([300, 200]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 300, height: 200 })
  }
  return new Uint8Array(await doc.save())
}
const line = 'Patient Name: Sunita Deshmukh Haemoglobin 10.8 g/dL'
const words = line.split(' ').reduce<{ t: string; c: number; s: number; e: number; b: [number, number, number, number] }[]>((acc, t) => {
  const s = acc.length ? acc[acc.length - 1].e + 1 : 0
  return [...acc, { t, c: 0.9, s, e: s + t.length, b: [s, 0, s + t.length, 10] }]
}, [])

/** A fake OCR: `onPage(n)` runs when page n (n-th first-pass call) is being read; it may wait or throw. */
function slowOcr(onPage: (n: number) => Promise<void> | void) {
  const state = { pages: 0 }
  const p: OcrProvider = {
    name: 'slow-ocr', version: '1',
    recognize: async (_img, langs) => {
      if (langs === 'eng+hin') { state.pages++; await onPage(state.pages) }
      return { text: line, words, lines: [{ text: line, conf: words.map((w) => w.c) }], mean: 0.9 }
    },
  }
  return { p, state }
}

async function newDoc(pages: number): Promise<string> {
  const c = await imp()
  const bytes = await scannedPdf(pages)
  const r = await c.db.withOrg(ORG, (tx) => c.ingest.ingestDocument(tx, { orgId: ORG, patientId: pid, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: `scan-${seed}.pdf`, bytes }))
  return r.documentId
}
const row = async (id: string) => (await owner`select status, stage, attempts, last_error, read_progress, locked_at from documents where id = ${id}`)[0]
const ageLock = (id: string) => owner`update documents set locked_at = now() - interval '10 minutes' where id = ${id}`

describe('claiming a document (atomic, capped)', () => {
  it('ten runners claim at once: exactly one gets it', async () => {
    const c = await imp()
    const id = await newDoc(1)
    const claims = await Promise.all(Array.from({ length: 10 }, () => c.proc.claimDocument(ORG, id)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect((await row(id)).attempts).toBe(1)
  })

  it('attempts never pass MAX_ATTEMPTS: a stale lock on a spent document marks it failed instead of starting another run', async () => {
    const c = await imp()
    const id = await newDoc(1)
    for (let n = 1; n <= c.proc.MAX_ATTEMPTS; n++) {
      expect((await c.proc.claimDocument(ORG, id))?.attempts).toBe(n)
      await ageLock(id) // the runner died, the lock went stale
    }
    expect(await c.proc.claimDocument(ORG, id)).toBeNull()
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: c.proc.MAX_ATTEMPTS, last_error: 'too_many_attempts' })
    expect(await c.proc.claimDocument(ORG, id)).toBeNull() // and stays that way
    expect((await row(id)).attempts).toBe(c.proc.MAX_ATTEMPTS)
  })

  it('a spent document is not offered to the patient queue again', async () => {
    const c = await imp()
    const id = await newDoc(1)
    await owner`update documents set status = 'processing', attempts = ${c.proc.MAX_ATTEMPTS}, locked_at = now() - interval '10 minutes' where id = ${id}`
    const next = await c.db.withOrg(ORG, (tx) => c.proc.nextWaiting(tx, pid, []))
    expect(next).not.toBe(id)
  })

  it('a processing row with no lock time at all counts as waiting', async () => {
    const c = await imp()
    const id = await newDoc(1)
    await owner`update documents set status = 'processing', attempts = 1, locked_at = null where id = ${id}`
    expect((await c.proc.claimDocument(ORG, id))?.attempts).toBe(2)
  })
})

describe('a slow OCR is not mistaken for a dead runner', () => {
  it('a heartbeat keeps the lock fresh, so a second runner cannot claim or start OCR while the first reads', async () => {
    const c = await imp()
    const id = await newDoc(3)
    let second: Promise<void> | null = null
    let secondOcrPages = 0
    let claimDuring: unknown = 'unset'
    let noteDuring: string | null = null
    const slow = slowOcr(async (n) => {
      if (n !== 2) return
      // Page 2 takes long. Meanwhile the clock runs past the stale window (as it did in the 19-minute run).
      await ageLock(id)
      await sleep(600) // the heartbeat (100 ms here) renews the lock in this time
      claimDuring = await c.proc.claimDocument(ORG, id)
      const other = slowOcr(() => { secondOcrPages++ })
      second = c.proc.runDocument(id, ORG, { ocr: other.p, heartbeatMs: 100 })
      await second
      const [d] = await c.db.withOrg(ORG, (tx) => c.q.documentStatus(tx, id).then((x) => [x]))
      noteDuring = d?.summary.progress ?? null
    })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })

    expect(claimDuring).toBeNull()
    expect(secondOcrPages).toBe(0)
    expect(noteDuring).toBe('Reading page 2 of 3')
    expect(slow.state.pages).toBe(3)
    const end = await row(id)
    expect(end.attempts).toBe(1) // one run, not seven
    expect(['done', 'needs_review']).toContain(end.status)
    expect(end.read_progress).toBeNull()
    expect(await owner`select 1 from document_read_cache where document_id = ${id}`).toHaveLength(0) // working data gone
  }, 60_000)

  it('control: with no heartbeat the same stale lock is taken over, and the first runner stops at its next page instead of working beside the new one', async () => {
    const c = await imp()
    const id = await newDoc(3)
    let stolen: { attempts: number } | null = null
    const slow = slowOcr(async (n) => {
      if (n !== 2) return
      await ageLock(id)
      stolen = await c.proc.claimDocument(ORG, id)
    })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 3_600_000 })
    expect(stolen).toMatchObject({ attempts: 2 })
    expect(slow.state.pages).toBe(2) // it did not go on to page 3
    // The first runner left the row alone: the new owner's claim is untouched.
    expect(await row(id)).toMatchObject({ status: 'processing', attempts: 2 })
  }, 60_000)
})

describe('a retry resumes at the page after the last one read', () => {
  it('a crash on page 3 of 4: the second attempt reads only pages 3 and 4', async () => {
    const c = await imp()
    const id = await newDoc(4)
    let crashed = false
    let cachedAtCrash = 0
    const slow = slowOcr(async (n) => {
      if (n === 3 && !crashed) {
        crashed = true
        cachedAtCrash = (await owner`select 1 from document_read_cache where document_id = ${id}`).length
        throw new Error('ocr crashed')
      }
    })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })

    expect(cachedAtCrash).toBe(2) // pages 1 and 2 were saved as they were read
    expect(slow.state.pages).toBe(5) // pages 1, 2, 3 (crash), then 3 and 4: not 1, 2, 3, 4 again
    const end = await row(id)
    expect(end.attempts).toBe(2)
    expect(['done', 'needs_review']).toContain(end.status)
    const pages = await owner`select page_no from document_pages where document_id = ${id} and superseded_at is null order by page_no`
    expect(pages.map((p) => p.page_no)).toEqual([1, 2, 3, 4]) // all four pages are in the record
    expect(await owner`select 1 from document_read_cache where document_id = ${id}`).toHaveLength(0)
  }, 60_000)

  it('three failures in a row end as failed after exactly MAX_ATTEMPTS runs, with the cache cleared', async () => {
    const c = await imp()
    const id = await newDoc(2)
    const slow = slowOcr(() => { throw new Error('ocr down') })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(slow.state.pages).toBe(c.proc.MAX_ATTEMPTS)
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: c.proc.MAX_ATTEMPTS })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 }) // nothing more happens
    expect(slow.state.pages).toBe(c.proc.MAX_ATTEMPTS)
  }, 60_000)
})

describe('the read cache follows the person', () => {
  it('a patient merge can move cache rows (the app role may update patient_id, as the merge does)', async () => {
    const c = await imp()
    const id = await newDoc(1)
    await owner`insert into document_read_cache (org_id, patient_id, document_id, page_no, data) values (${ORG}, ${pid}, ${id}, 1, ${owner.json({ text: 'x' })})`
    const moved = await c.db.withOrg(ORG, (tx) => tx.execute(sqlTag`update document_read_cache set patient_id = ${pid} where patient_id = ${pid} and document_id = ${id}`))
    expect((moved as unknown as { count: number }).count).toBe(1)
  })
})
