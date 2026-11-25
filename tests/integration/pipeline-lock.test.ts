// Processing reliability on real scanned reports (a 16-page scan was run 7 times, MAX_ATTEMPTS being 3): the claim is atomic
// and capped, a live runner renews its lock while OCR runs (so a slow OCR is never taken for a dead runner), and a retry
// resumes at the page after the last one read. Attempts count only runs that saved no new page; a run stops before the
// time limit and goes back to the queue; one file is read at a time per instance. OCR is a fake, slow provider.
//   npm run test:integration
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { sql as sqlTag } from 'drizzle-orm'
import postgres from 'postgres'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'
import type { OcrProvider } from '../../src/server/pipeline/text'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid: string = randomUUID()
const pids = [pid]
const imp = async () => ({
  db: await import('../../src/db'), s: await import('../../src/db/schema'),
  ingest: await import('../../src/server/pipeline/ingest'), proc: await import('../../src/server/pipeline/process'),
  q: await import('../../src/server/pipeline/queries'), crypto: await import('../../src/server/crypto'),
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A patient with store consent (`id`: the main one, or a fresh one so a queue test sees only its own documents). */
async function addPatient(id: string = randomUUID()): Promise<string> {
  const c = await imp()
  if (!pids.includes(id)) pids.push(id)
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${id}, ${ORG}, ${'t-' + id}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female', 'cleared')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${id}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
  return id
}

beforeAll(() => addPatient(pid), 60_000)
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const p of pids) for (const t of ['evidence', 'events', 'missing_records', 'ai_runs', 'document_read_cache', 'document_pages', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${p}'`)
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

async function newDoc(pages: number, patientId = pid): Promise<string> {
  const c = await imp()
  const bytes = await scannedPdf(pages)
  const r = await c.db.withOrg(ORG, (tx) => c.ingest.ingestDocument(tx, { orgId: ORG, patientId, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: `scan-${seed}.pdf`, bytes }))
  return r.documentId
}
const row = async (id: string) => (await owner`select status, stage, attempts, last_error, read_progress, locked_at, flags from documents where id = ${id}`)[0]
const ageLock = (id: string) => owner`update documents set locked_at = now() - interval '10 minutes' where id = ${id}`
const cachedPages = async (id: string) => (await owner`select page_no from document_read_cache where document_id = ${id} order by page_no`).map((r) => r.page_no)
const recordPages = async (id: string) => (await owner`select page_no from document_pages where document_id = ${id} and superseded_at is null order by page_no`).map((r) => r.page_no)
/** What a run saves once slowOcr has read page n (so a later run takes it as read). */
const cachePage = (id: string, n: number, patientId = pid) => owner`insert into document_read_cache (org_id, patient_id, document_id, page_no, data) values (${ORG}, ${patientId}, ${id}, ${n}, ${owner.json({
  pageNo: n, text: line, words, ocrConfidence: 0.9, lowConfidence: false, source: 'ocr', handwriting: { handwritten: false, lowLineShare: 0, lines: 1, blueInkShare: 0 },
  hidden: null, processor: 'slow-ocr', processorVersion: '1',
})})`
/** Claims the next claim would count against MAX_ATTEMPTS (0: the last run moved the reading forward). */
const spentNow = async (id: string) => {
  const c = await imp()
  const r = await row(id)
  return c.proc.attemptsSpent(r.attempts, (await cachedPages(id)).length, (r.flags as { reading?: { pages?: number; base?: number } }).reading).spent
}
const finished = (status: string) => ['done', 'needs_review'].includes(status)

describe('claiming a document (atomic, capped)', () => {
  it('ten runners claim at once: exactly one gets it', async () => {
    const c = await imp()
    const id = await newDoc(1)
    const claims = await Promise.all(Array.from({ length: 10 }, () => c.proc.claimDocument(ORG, id)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect((await row(id)).attempts).toBe(1)
  })

  it('runners that read the row while another transaction holds it decide only once it is free: exactly one claims it', async () => {
    const c = await imp()
    const id = await newDoc(1)
    let free!: () => void
    const held = new Promise<void>((r) => { free = r })
    let locked!: () => void
    const isLocked = new Promise<void>((r) => { locked = r })
    const holder = owner.begin(async (tx) => { await tx`select 1 from documents where id = ${id} for update`; locked(); await held })
    await isLocked
    const claims = Promise.all(Array.from({ length: 10 }, () => c.proc.claimDocument(ORG, id)))
    await sleep(500) // every pooled runner has reached the row by now
    free()
    await holder
    expect((await claims).filter(Boolean)).toHaveLength(1)
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

  it('a spent document left processing is offered to the queue (the claim\'s own rule) and marked failed, never left processing', async () => {
    const c = await imp()
    const p = await addPatient()
    const id = await newDoc(1, p)
    await owner`update documents set status = 'processing', attempts = ${c.proc.MAX_ATTEMPTS}, locked_at = now() - interval '10 minutes' where id = ${id}`
    const next = () => c.db.withOrg(ORG, (tx) => c.proc.nextWaiting(tx, p, []))
    expect(await next()).toBe(id)
    const slow = slowOcr(() => {})
    await c.proc.runPatientQueue(p, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(slow.state.pages).toBe(0)
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: c.proc.MAX_ATTEMPTS, last_error: 'too_many_attempts' })
    expect(await next()).toBeNull()
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
    let second: Promise<boolean> | null = null
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

describe('attempts count runs that saved nothing, never runs that saved pages', () => {
  it('runs killed (memory, time limit) after saving pages never use up attempts; the next run reads only the rest', async () => {
    const c = await imp()
    const id = await newDoc(5)
    for (let n = 1; n <= c.proc.MAX_ATTEMPTS + 1; n++) { // more killed runs than MAX_ATTEMPTS, each after saving one page
      expect(await c.proc.claimDocument(ORG, id)).toMatchObject({ attempts: n, spent: 1 })
      await cachePage(id, n)
      await ageLock(id) // killed: no code ran after the page was saved
    }
    const slow = slowOcr(() => {})
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(slow.state.pages).toBe(1) // page 5 only
    const end = await row(id)
    expect(finished(end.status)).toBe(true)
    expect(end.attempts).toBe(c.proc.MAX_ATTEMPTS + 2)
    expect(await recordPages(id)).toEqual([1, 2, 3, 4, 5])
    expect(await cachedPages(id)).toEqual([])
  }, 60_000)

  it('MAX_ATTEMPTS runs in a row that save no new page end as failed; the read cache is kept until then', async () => {
    const c = await imp()
    const id = await newDoc(3)
    await cachePage(id, 1) // saved by an earlier run
    for (let n = 1; n <= c.proc.MAX_ATTEMPTS; n++) {
      expect(await c.proc.claimDocument(ORG, id)).toMatchObject({ attempts: n, spent: n })
      await ageLock(id) // died without saving a page
      expect(await cachedPages(id)).toEqual([1])
    }
    expect(await c.proc.claimDocument(ORG, id)).toBeNull()
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: c.proc.MAX_ATTEMPTS, last_error: 'too_many_attempts' })
    expect(await cachedPages(id)).toEqual([]) // abandoned now: working data gone
  })

  it('a document left processing with its attempts used up and most pages cached (as on the pilot) finishes from its cached pages', async () => {
    const c = await imp()
    const p = await addPatient()
    const id = await newDoc(5, p)
    for (let n = 1; n <= 4; n++) await cachePage(id, n, p)
    // As the old rule left it: attempts at the cap, a stale lock, the last progress note, no reading mark in flags.
    await owner`update documents set status = 'processing', stage = 'text', attempts = ${c.proc.MAX_ATTEMPTS}, locked_at = now() - interval '10 minutes',
      read_progress = ${owner.json({ page: 5, total: 5 })} where id = ${id}`
    const slow = slowOcr(() => {})
    await c.proc.runPatientQueue(p, ORG, { ocr: slow.p, heartbeatMs: 100 }) // what the documents screen's poll starts
    expect(slow.state.pages).toBe(1)
    const end = await row(id)
    expect(finished(end.status)).toBe(true)
    expect(await recordPages(id)).toEqual([1, 2, 3, 4, 5])
    expect(await cachedPages(id)).toEqual([])
  }, 60_000)
})

describe('a run stops before the time limit and the document goes straight back to the queue', () => {
  it('past the deadline a run stops between pages (after reading at least one): queued, pages kept, no attempt used, then continues', async () => {
    const c = await imp()
    const id = await newDoc(3)
    // The deadline passes before page 1 is reached; page 1 is still read (a run that stops for time always saved a page).
    const slow = slowOcr(async (n) => { if (n === 1) await sleep(50) })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100, deadline: Date.now() + 2 })
    expect(slow.state.pages).toBe(1)
    const r = await row(id)
    expect(r).toMatchObject({ status: 'queued', attempts: 1, read_progress: null, locked_at: null, last_error: null })
    expect(c.q.needsRunner({ status: r.status, lockedAt: r.locked_at })).toBe(true) // the next poll starts it at once
    expect(await cachedPages(id)).toEqual([1])
    expect(await spentNow(id)).toBe(0)
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(slow.state.pages).toBe(3) // pages 2 and 3, not page 1 again
    const end = await row(id)
    expect(finished(end.status)).toBe(true)
    expect(end.attempts).toBe(2)
    expect(await recordPages(id)).toEqual([1, 2, 3])
  }, 60_000)

  it('reading done past the deadline: stops before saving and extracting, and the next run does both from the cache', async () => {
    const c = await imp()
    const id = await newDoc(1)
    const slow = slowOcr(async () => { await sleep(50) })
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100, deadline: Date.now() + 2 })
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 1 })
    expect(await recordPages(id)).toEqual([])
    expect(await cachedPages(id)).toEqual([1])
    await c.proc.runDocument(id, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(slow.state.pages).toBe(1) // not read again
    expect(finished((await row(id)).status)).toBe(true)
    expect(await recordPages(id)).toEqual([1])
  }, 60_000)

  it('a runner past its deadline starts no document, and claims none', async () => {
    const c = await imp()
    const p = await addPatient()
    const id = await newDoc(1, p)
    await c.proc.runPatientQueue(p, ORG, { deadline: Date.now() - 1 })
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 })
    await c.proc.runDocument(id, ORG, { deadline: Date.now() - 1 }) // an upload's own runner, started late
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 })
  })
})

describe('one file is read at a time per instance', () => {
  it('a runner started while another file is being read leaves its document waiting, unclaimed; the slot is free afterwards', async () => {
    const c = await imp()
    const a = await newDoc(2)
    const b = await newDoc(1)
    let during: Record<string, unknown> | null = null
    let busy = false
    let bWorkedDuring: boolean | null = null
    const slow = slowOcr(async (n) => {
      if (n !== 1) return
      busy = c.proc.readSlotBusy()
      bWorkedDuring = await c.proc.runDocument(b, ORG, { ocr: slow.p, heartbeatMs: 100 }) // returns at once
      during = await row(b)
    })
    // The return value says whether the run claimed anything: only a run that worked hands on to the next waiting file.
    expect(await c.proc.runDocument(a, ORG, { ocr: slow.p, heartbeatMs: 100 })).toBe(true)
    expect(busy).toBe(true)
    expect(bWorkedDuring).toBe(false)
    expect(during).toMatchObject({ status: 'queued', attempts: 0 })
    expect(slow.state.pages).toBe(2) // a's two pages only
    expect(c.proc.readSlotBusy()).toBe(false)
    expect(await c.proc.runDocument(b, ORG, { ocr: slow.p, heartbeatMs: 100 })).toBe(true)
    expect(finished((await row(b)).status)).toBe(true)
    expect(await c.proc.runDocument(b, ORG, { ocr: slow.p, heartbeatMs: 100 })).toBe(false) // finished: nothing to claim
  }, 60_000)

  it('the slot is free as soon as the pages are read, so the next file can be read while this one is saved and extracted', async () => {
    const c = await imp()
    const a = await newDoc(1)
    let free!: () => void
    const held = new Promise<void>((r) => { free = r })
    let locked!: () => void
    const isLocked = new Promise<void>((r) => { locked = r })
    let holder: Promise<unknown> = Promise.resolve()
    const slow = slowOcr(async () => {
      // Saving the pages waits for this table lock, so the run stays between reading and saving while it is held.
      holder = owner.begin(async (tx) => { await tx`lock table document_pages in share mode`; locked(); await held })
      await isLocked
    })
    const run = c.proc.runDocument(a, ORG, { ocr: slow.p, heartbeatMs: 100 })
    expect(c.proc.readSlotBusy()).toBe(true)
    try {
      await vi.waitFor(() => expect(c.proc.readSlotBusy()).toBe(false), { timeout: 3000 })
    } finally {
      free()
      await holder
      await run
    }
    expect(finished((await row(a)).status)).toBe(true)
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
