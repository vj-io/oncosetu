// Postgres-backed processing state machine (ADR-001a; no queue). A runner claims a document with an atomic UPDATE,
// advances documents.stage received → text → classified → identity → extracted → gate → completeness and ends in
// done | needs_review | failed | quarantined | unreadable. A lock older than 3 minutes is re-claimable, so the status
// poll (GET /api/documents/[id]/status) or "reprocess" restarts a runner that died. A live runner renews its lock every
// 30 s (heartbeat, and at every page of a long scan), so a slow OCR is never mistaken for a dead runner; the claim is
// capped at MAX_ATTEMPTS, and OCR'd pages are saved one by one so a retry resumes at the next page.
import { and, asc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { withOrg, type Tx } from '@/db'
import { aiRuns, documentFiles, documentPages, documentReadCache, documents, events, evidence, patientAliases, patients, verifications } from '@/db/schema'
import { sha256Hex } from '@/core/hash'
import { decideIdentity, type PatientIdentity } from '@/core/identity'
import { writeAudit } from '@/server/audit'
import { decryptField } from '@/server/crypto'
import { storedBytes, storeFile } from '@/server/files'
import { log } from '@/server/log'
import { activeConsent } from '@/server/patients'
import { llmExtractor, type AiRunRecord } from '@/server/ai/extract'
import { makeScrubber } from '@/server/ai/scrub'
import { aiAllowed } from '@/server/ai/provider'
import { classify, extractCandidates, gateAndDate, identify, injectionReport, rejectionLog, type DraftEvent } from './core'
import { recomputeRadar } from './radar'
import { textSimilarity } from './safety'
import { IMAGE_PROCESSOR, readPages, type CachedPage, type OcrProvider, type PageRead } from './text'

export const STAGES = ['received', 'text', 'classified', 'identity', 'extracted', 'gate', 'completeness'] as const
export type Stage = (typeof STAGES)[number]
export const MAX_ATTEMPTS = 3
export const STALE_LOCK_MINUTES = 3
/** A runner renews its lock this often while it works; far inside STALE_LOCK_MINUTES. */
export const HEARTBEAT_MS = 30_000

class Abort extends Error {}

/** Waiting for a runner: queued, or processing with no live runner (a lock never renewed for STALE_LOCK_MINUTES, or none at all). */
const claimable = sql`(status = 'queued' OR (status = 'processing' AND (locked_at IS NULL OR locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))))`

/**
 * Atomic claim (one UPDATE decides): queued, or processing with a stale lock, and never past MAX_ATTEMPTS. Returns null if
 * another runner has it, it is finished, or it has used up its attempts (then it is marked failed, so nothing starts it again).
 */
export async function claimDocument(orgId: string, documentId: string): Promise<{ id: string; attempts: number } | null> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE documents SET status = 'processing', locked_at = now(), attempts = attempts + 1, read_progress = NULL, updated_at = now()
      WHERE id = ${documentId} AND attempts < ${MAX_ATTEMPTS} AND ${claimable}
      RETURNING id, attempts`)
    const r = (rows as unknown as { id: string; attempts: number }[])[0]
    if (r) return { id: r.id, attempts: Number(r.attempts) }
    const spent = await tx.execute(sql`
      UPDATE documents SET status = 'failed', locked_at = NULL, read_progress = NULL, last_error = 'too_many_attempts', updated_at = now()
      WHERE id = ${documentId} AND attempts >= ${MAX_ATTEMPTS} AND ${claimable}
      RETURNING id`)
    if ((spent as unknown as unknown[]).length) {
      await clearReadCache(tx, documentId)
      log.error('pipeline.attempts_exhausted', { documentId })
    }
    return null
  })
}

/** The OCR'd pages saved for resuming a reading (working data; gone once the document finishes, fails or is reprocessed). */
export async function clearReadCache(tx: Tx, documentId: string): Promise<void> {
  await tx.delete(documentReadCache).where(eq(documentReadCache.documentId, documentId))
}

type Heartbeat = ReturnType<typeof startHeartbeat>

/**
 * Keeps one runner's lock alive while it works (OCR of a long scan can take minutes between stage changes). It renews
 * only while this runner's claim is still the current one (status processing, same attempt number); once another claim
 * or an abort took the document over, `check()` throws so this runner stops instead of working beside the new one.
 */
function startHeartbeat(orgId: string, documentId: string, attempt: number, everyMs: number) {
  let lost = false
  let busy = false
  const beat = async () => {
    if (busy || lost) return
    busy = true
    try {
      const rows = await withOrg(orgId, (tx) => tx.execute(sql`
        UPDATE documents SET locked_at = now() WHERE id = ${documentId} AND status = 'processing' AND attempts = ${attempt} RETURNING id`))
      if (!(rows as unknown as unknown[]).length) lost = true
    } catch (err) {
      log.error('pipeline.heartbeat_failed', { documentId, err }) // a missed beat is harmless; the next one renews
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void beat(), everyMs)
  timer.unref?.()
  return {
    beat,
    check() { if (lost) throw new Abort('lock_lost') },
    markLost() { lost = true },
    stop() { clearInterval(timer) },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The patient's next document to process, in queue order: UUIDv7 ids follow upload order, and every batch is uploaded and
 * ingested in backlog order (src/core/backlog.ts). Queued, or processing with a stale lock (the claim's own rule).
 * `skip`: documents this runner already tried (a document put back to 'queued' by an abort must not loop forever).
 */
export async function nextWaiting(tx: Tx, patientId: string, skip: readonly string[] = []): Promise<string | null> {
  const [r] = await tx.select({ id: documents.id }).from(documents).where(and(
    eq(documents.patientId, patientId),
    lt(documents.attempts, MAX_ATTEMPTS),
    or(eq(documents.status, 'queued'), and(eq(documents.status, 'processing'), or(isNull(documents.lockedAt), lt(documents.lockedAt, sql`now() - make_interval(mins => ${STALE_LOCK_MINUTES})`)))),
    skip.length ? notInArray(documents.id, [...skip]) : undefined,
  )).orderBy(asc(documents.id)).limit(1)
  return r?.id ?? null
}

/**
 * FR-ONB-01, strict order: work through the patient's waiting documents in queue order until none is left. Every runner
 * (a batch's workers, the documents screen's poll) takes the next one, so documents start in order whoever runs them;
 * the claim keeps two runners off one document.
 */
export async function runPatientQueue(patientId: string, orgId: string): Promise<void> {
  const tried: string[] = []
  for (let id = await withOrg(orgId, (tx) => nextWaiting(tx, patientId)); id; id = await withOrg(orgId, (tx) => nextWaiting(tx, patientId, tried))) {
    tried.push(id)
    await runDocument(id, orgId)
  }
}

/** Claim + process with retries and backoff (E-DOC-20). Never throws. */
export type RunOpts = {
  password?: string
  /** Page OCR (tesseract unless a test passes another). */
  ocr?: OcrProvider
  /** Lock renewal interval (HEARTBEAT_MS; tests shorten it). */
  heartbeatMs?: number
}

export async function runDocument(documentId: string, orgId: string, opts: RunOpts = {}): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const claim = await claimDocument(orgId, documentId)
    if (!claim) return
    const hb = startHeartbeat(orgId, documentId, claim.attempts, opts.heartbeatMs ?? HEARTBEAT_MS)
    try {
      await processClaimed(orgId, documentId, opts, claim.attempts, hb)
      return
    } catch (err) {
      // Another runner owns the document now: leave its row alone.
      if (err instanceof Abort && err.message === 'lock_lost') {
        log.error('pipeline.lock_lost', { documentId, attempt: claim.attempts })
        return
      }
      const final = claim.attempts >= MAX_ATTEMPTS
      log.error('pipeline.stage_failed', { documentId, attempt: claim.attempts, final, err })
      await withOrg(orgId, async (tx) => {
        await tx.update(documents).set({
          status: final ? 'failed' : 'queued', lockedAt: null, readProgress: null, lastError: err instanceof Abort ? err.message : 'processing_error', updatedAt: new Date(),
        }).where(and(eq(documents.id, documentId), eq(documents.status, 'processing'), eq(documents.attempts, claim.attempts)))
        if (final || err instanceof Abort) await clearReadCache(tx, documentId)
      }).catch(() => {})
      if (final || err instanceof Abort) return
      await sleep(1000 * 2 ** i)
    } finally {
      hb.stop()
    }
  }
}

async function setStage(orgId: string, documentId: string, stage: Stage, extra: Partial<typeof documents.$inferInsert> = {}) {
  await withOrg(orgId, (tx) => tx.update(documents).set({ stage, lockedAt: new Date(), updatedAt: new Date(), ...extra }).where(eq(documents.id, documentId)))
}

/** E-CON-02: consent is re-checked between stages; withdrawn → abort and discard this run's outputs. */
async function consentStillActive(orgId: string, documentId: string, patientId: string): Promise<void> {
  const ok = await withOrg(orgId, async (tx) => !!(await activeConsent(tx, patientId))?.purposes.store)
  if (ok) return
  await withOrg(orgId, async (tx) => {
    await clearReadCache(tx, documentId)
    await tx.delete(documentPages).where(eq(documentPages.documentId, documentId))
    await tx.delete(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'page_image')))
    await tx.update(documents).set({ status: 'failed', stage: 'received', lockedAt: null, lastError: 'consent_withdrawn', updatedAt: new Date() }).where(eq(documents.id, documentId))
    await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'document.processing_aborted', targetType: 'document', targetId: documentId, details: { reason: 'consent_withdrawn' } })
  })
  throw new Abort('consent_withdrawn')
}

/** Identity facts the header is compared against (name, aliases, DOB, sex, hospital MRN). */
export async function patientIdentity(tx: Tx, patientId: string): Promise<PatientIdentity> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  const aliases = await tx.select({ nameEnc: patientAliases.nameEnc }).from(patientAliases).where(eq(patientAliases.patientId, patientId))
  return {
    name: decryptField(p.nameEnc), aliases: aliases.map((a) => decryptField(a.nameEnc)), dob: p.dobEnc ? decryptField(p.dobEnc) : null,
    sex: p.sex === 'unknown' ? null : p.sex, mrns: p.mrn ? [p.mrn] : [],
  }
}

async function processClaimed(orgId: string, documentId: string, opts: RunOpts, attempt: number, hb: Heartbeat) {
  const loaded = await withOrg(orgId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId))
    const [file] = await tx.select().from(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'original')))
    return doc && file ? { doc, bytes: await storedBytes(file) } : null
  })
  if (!loaded) throw new Abort('original_missing')
  const { doc, bytes } = loaded
  const { patientId } = doc
  const flags: Record<string, unknown> = { ...doc.flags }
  for (const k of ['password_required', 'password_incorrect', 'unreadable_reason', 'injection', 'language_unsupported', 'mixed_document', 'gate', 'extraction', 'consent_withdrawn']) delete flags[k]

  if ((doc.flags.file as { storedOnly?: boolean } | undefined)?.storedOnly) return processStored(orgId, doc, flags)
  /** Between stages: still the one runner on this document, and consent still on. */
  const guard = async () => {
    hb.check()
    await consentStillActive(orgId, documentId, patientId)
  }

  // ── text ──
  await guard()
  await setStage(orgId, documentId, 'text')
  // Pages an earlier attempt already OCR'd are taken as read; every page read now is saved at once, and the lock is renewed
  // before and after each page ("Reading page 7 of 16" is what staff see meanwhile).
  const cached = new Map((await withOrg(orgId, (tx) => tx.select({ pageNo: documentReadCache.pageNo, data: documentReadCache.data }).from(documentReadCache)
    .where(eq(documentReadCache.documentId, documentId)))).map((r) => [r.pageNo, r.data as unknown as CachedPage]))
  const read = await readPages(new Uint8Array(bytes), doc.mime, opts.password, opts.ocr, {
    cached,
    onPage: async ({ pageNo, total, page, fresh }) => {
      hb.check()
      if (!page) {
        const rows = await withOrg(orgId, (tx) => tx.execute(sql`
          UPDATE documents SET read_progress = ${JSON.stringify({ page: pageNo, total })}::jsonb, locked_at = now(), updated_at = now()
          WHERE id = ${documentId} AND status = 'processing' AND attempts = ${attempt} RETURNING id`))
        if (!(rows as unknown as unknown[]).length) { hb.markLost(); hb.check() }
      } else if (fresh && page.source === 'ocr') {
        const data = { ...page, image: undefined } as CachedPage // the image is rebuilt on resume, never stored here
        await withOrg(orgId, (tx) => tx.insert(documentReadCache).values({ documentId, orgId: doc.orgId, patientId, pageNo, data: data as unknown as Record<string, unknown> }).onConflictDoNothing())
        await hb.beat()
      }
    },
  })
  if (read.kind !== 'pages') {
    if (read.kind === 'needs_password') {
      flags.password_required = true
      if (read.incorrect) flags.password_incorrect = true
    } else flags.unreadable_reason = read.reason
    await withOrg(orgId, async (tx) => {
      await clearReadCache(tx, documentId)
      await tx.update(documents).set({ status: 'unreadable', lockedAt: null, readProgress: null, flags, lastError: read.kind === 'needs_password' ? 'needs_password' : read.reason, updatedAt: new Date() }).where(eq(documents.id, documentId))
      await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'document.unreadable', targetType: 'document', targetId: documentId, details: { reason: read.kind === 'needs_password' ? 'needs_password' : read.reason } })
    })
    return
  }
  const pages = read.pages
  const injection = injectionReport(pages)
  if (injection.flagged) flags.injection = injection
  await withOrg(orgId, (tx) => savePages(tx, doc, pages, flags))
  await guard()

  // ── classified ──
  await setStage(orgId, documentId, 'classified', { readProgress: null })
  const manualType = doc.manualTags.includes('doc_type') && doc.docType ? (doc.docType as Parameters<typeof classify>[1]) : null
  let classified = classify(pages, manualType)
  if (classified.languageUnsupported) flags.language_unsupported = true
  if (classified.pageTypes.length) flags.mixed_document = classified.pageTypes
  await setStage(orgId, documentId, 'identity', {
    docType: classified.docType, docTypeConfidence: classified.docTypeConfidence, language: classified.language, handwritten: classified.handwritten,
    lowConfidence: pages.some((p) => p.lowConfidence), injectionFlag: injection.flagged, pages: pages.length, flags,
  })

  // ── identity ── (before any LLM call: a wrong-patient document is never sent to a model under this patient's consent)
  const ident = await withOrg(orgId, async (tx) => {
    const receivedAt = doc.receivedAt
    const id = identify(pages, classified, await patientIdentity(tx, patientId), receivedAt)
    if (id.accession) flags.accession = id.accession
    // E-DOC-03: an addendum with the same accession as an earlier report is linked as its amendment.
    let amendmentOf: string | null = null
    if (id.isAddendum && id.accession) {
      const [orig] = await tx.select({ id: documents.id, docType: documents.docType }).from(documents).where(and(
        eq(documents.patientId, patientId), ne(documents.id, documentId), inArray(documents.attachState, ['auto', 'attached']),
        sql`${documents.flags}->>'accession' = ${id.accession}`,
      )).orderBy(documents.documentDate, documents.receivedAt).limit(1)
      if (orig) {
        amendmentOf = orig.id
        if (!manualType && orig.docType && classified.docTypeConfidence < 0.5) classified = { ...classified, docType: orig.docType as typeof classified.docType }
      }
    }
    const machineMatch = id.identity.result === 'match'
    const attachState = doc.attachState === 'attached' || doc.attachState === 'rejected' || doc.attachState === 'detached' ? doc.attachState : machineMatch ? 'auto' : 'pending_decision'
    const docDate = id.documentDate && id.documentDate.precision !== 'unknown' ? id.documentDate.iso : null
    await tx.update(documents).set({
      identityResult: id.identity.result, identityDetails: { ...id.identity, header: id.header, documentDateFlags: id.documentDate?.flags ?? [] },
      attachState, documentDate: doc.manualTags.includes('document_date') ? doc.documentDate : docDate,
      institutionName: doc.manualTags.includes('institution') ? doc.institutionName : id.institution, amendmentOf, docType: classified.docType, flags,
      updatedAt: new Date(),
    }).where(eq(documents.id, documentId))
    return { id, attachState }
  })
  // FR-ID-05: mismatch / insufficient → held out of the record until a person decides (attach with reason, or reject).
  if (ident.attachState === 'pending_decision' || ident.attachState === 'rejected' || ident.attachState === 'detached') {
    await finish(orgId, documentId, patientId, ident.attachState === 'pending_decision' ? 'needs_review' : 'done', flags, { held: ident.attachState })
    return
  }
  await guard()

  // ── extracted ──
  await setStage(orgId, documentId, 'extracted')
  const runs: AiRunRecord[] = []
  const ai = await withOrg(orgId, async (tx) => ({ ...(await aiAllowed(tx, orgId, patientId)), identity: await patientIdentity(tx, patientId) }))
  const ex = await extractCandidates(classified, ai.provider ? llmExtractor(ai.provider, runs, undefined, makeScrubber(ai.identity)) : null, { augmentRules: ai.provider?.augmentRules })
  if (ex.method === 'llm' && ex.llmDocType && !manualType && ex.llmDocType !== classified.docType) classified = { ...classified, docType: ex.llmDocType, docTypeConfidence: 0.9 }
  // A free-tier quota refusal is not an error: the rule-based path ran instead, and the document says why.
  const quotaSkip = runs.find((r) => r.outcome.startsWith('quota_'))?.outcome
  const llmOff = ai.reason ?? quotaSkip ?? (runs.some((r) => r.outcome === 'rate_limited') ? 'rate_limited' : null)
  flags.extraction = { method: ex.method, ...(llmOff ? { llm_off: llmOff } : {}) }
  await withOrg(orgId, async (tx) => {
    if (runs.length) {
      await tx.insert(aiRuns).values(runs.map((r) => ({ orgId, patientId, documentId, ...r })))
    }
    await tx.update(documents).set({ docType: classified.docType, docTypeConfidence: classified.docTypeConfidence, flags, stage: 'gate', lockedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId))
  })
  await guard()

  // ── gate ──
  const { gate, drafts } = gateAndDate(ex.candidates, classified, ident.id, doc.receivedAt, ex.method)
  const reasons: Record<string, number> = {}
  for (const r of gate.rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1
  flags.gate = { candidates: ex.candidates.length, accepted: gate.accepted.length, kept: drafts.length, rejected: gate.rejected.length, reasons, rejections: rejectionLog(gate.rejected) }
  const counts = await withOrg(orgId, (tx) => persistEvents(tx, doc, drafts, pages, ident.attachState === 'attached'))
  await guard()

  // ── completeness ──
  await setStage(orgId, documentId, 'completeness', { flags })
  const review = classified.handwritten || classified.languageUnsupported || injection.flagged || !!doc.nearDupOf || !!flags.near_duplicate || pages.some((p) => p.lowConfidence)
  await finish(orgId, documentId, patientId, review ? 'needs_review' : 'done', flags, { events: counts.created, rejected: gate.rejected.length })
}

/**
 * Imaging, ECG and video files are stored and shown, never read: no text, no OCR, no facts. The only check is who the file
 * says it belongs to. A DICOM header carries a name, sex and age (or birth date): they go through the same identity
 * decision as a report header, and a mismatch is held for a person exactly like a wrong-patient report. A file with
 * no identity in it (video, NIfTI, most ECG exports) is held until a person attaches it.
 */
async function processStored(orgId: string, doc: typeof documents.$inferSelect, flags: Record<string, unknown>) {
  const { id: documentId, patientId } = doc
  await consentStillActive(orgId, documentId, patientId)
  await setStage(orgId, documentId, 'identity')
  const img = flags.imaging as { patientName?: string | null; patientSex?: string | null; patientAge?: string | null; patientDob?: string | null; studyDate?: string | null; institution?: string | null } | undefined
  const decision = await withOrg(orgId, async (tx) => {
    const d = decideIdentity(await patientIdentity(tx, patientId), { name: img?.patientName ?? null, sex: img?.patientSex ?? null, age: img?.patientAge ?? null, dob: img?.patientDob ?? null }, img?.studyDate ?? null)
    const keep = doc.attachState === 'attached' || doc.attachState === 'rejected' || doc.attachState === 'detached'
    const attachState = keep ? doc.attachState : d.result === 'match' ? 'auto' : 'pending_decision'
    await tx.update(documents).set({
      identityResult: d.result, identityDetails: { ...d, header: img ? Object.fromEntries(([['name', img.patientName], ['sex', img.patientSex === 'F' ? 'Female' : img.patientSex === 'M' ? 'Male' : img.patientSex], ['age', img.patientAge], ['dob', img.patientDob], ['reportDate', img.studyDate]] as const).filter(([, v]) => v).map(([k, v]) => [k, { value: v }])) : {} }, attachState,
      documentDate: img?.studyDate ?? doc.documentDate, institutionName: img?.institution ?? doc.institutionName, docType: 'other', pages: 0, updatedAt: new Date(),
    }).where(eq(documents.id, documentId))
    return { d, attachState }
  })
  flags.extraction = { method: 'none' }
  await setStage(orgId, documentId, 'completeness', { flags })
  await finish(orgId, documentId, patientId, decision.attachState === 'pending_decision' ? 'needs_review' : 'done', flags, { stored: 1, identity: decision.d.result })
}

async function finish(orgId: string, documentId: string, patientId: string, status: 'done' | 'needs_review', flags: Record<string, unknown>, details: Record<string, string | number>) {
  await withOrg(orgId, async (tx) => {
    await recomputeRadar(tx, orgId, patientId)
    await clearReadCache(tx, documentId)
    await tx.update(documents).set({ status, lockedAt: null, lastError: null, readProgress: null, flags, updatedAt: new Date() }).where(eq(documents.id, documentId))
    await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'document.processed', targetType: 'document', targetId: documentId, details: { status, ...details } })
  })
}

/** FR-DOC-08: a new reading supersedes the earlier page text and page images; they are kept, never deleted or changed. */
async function savePages(tx: Tx, doc: typeof documents.$inferSelect, pages: PageRead[], flags: Record<string, unknown>) {
  const at = new Date()
  await tx.update(documentPages).set({ supersededAt: at }).where(and(eq(documentPages.documentId, doc.id), isNull(documentPages.supersededAt)))
  await tx.update(documentFiles).set({ supersededAt: at }).where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.kind, 'page_image'), isNull(documentFiles.supersededAt)))
  for (const p of pages) {
    await tx.insert(documentPages).values({
      orgId: doc.orgId, patientId: doc.patientId, documentId: doc.id, pageNo: p.pageNo,
      // FR-DOC-07: handwritten pages are stored as images only — no machine text is kept for them.
      text: p.handwriting?.handwritten ? '' : p.text, words: p.handwriting?.handwritten ? null : p.words,
      ocrConfidence: p.ocrConfidence, lowConfidence: p.lowConfidence, processor: p.processor, processorVersion: p.processorVersion,
      textHash: sha256Hex(p.text),
    })
    // ponytail: with an object store each page image is one upload made inside this transaction (about 0.1 to 0.3 s each),
    // so a 100-page scan holds it for some seconds; upload them in parallel before the transaction if that ever matters.
    if (p.image) await storeFile(tx, { orgId: doc.orgId, patientId: doc.patientId, documentId: doc.id, kind: 'page_image', pageNo: p.pageNo, mime: 'image/jpeg', bytes: p.image, processor: IMAGE_PROCESSOR })
  }
  await tx.update(documents).set({
    quality: {
      pages: pages.map((p) => ({ pageNo: p.pageNo, source: p.source, ocrConfidence: p.ocrConfidence, lowConfidence: p.lowConfidence, handwriting: p.handwriting })),
      // E-DOC-16: invisible text removed before extraction, kept for staff review only.
      hidden: pages.filter((p) => p.hidden).map((p) => ({ pageNo: p.pageNo, text: p.hidden })),
    },
    processor: pages[0]?.processor ?? null, processorVersion: pages[0]?.processorVersion ?? null,
  }).where(eq(documents.id, doc.id))

  // FR-ING-06: near-duplicate text-layer PDFs (word-trigram similarity ≥ 0.95) against this patient's documents.
  if (doc.mime === 'application/pdf' && !doc.nearDupOf) {
    const mine = pages.map((p) => p.text).join('\n')
    const others = await tx.select({ documentId: documentPages.documentId, text: documentPages.text }).from(documentPages)
      .innerJoin(documents, eq(documents.id, documentPages.documentId))
      .where(and(eq(documentPages.patientId, doc.patientId), ne(documentPages.documentId, doc.id), ne(documents.attachState, 'detached'), isNull(documentPages.supersededAt)))
    const byDoc = new Map<string, string>()
    for (const o of others) byDoc.set(o.documentId, (byDoc.get(o.documentId) ?? '') + '\n' + o.text)
    const best = [...byDoc].map(([id, t]) => ({ id, s: textSimilarity(mine, t) })).sort((a, b) => b.s - a.s)[0]
    if (best && best.s >= 0.95) {
      flags.near_duplicate = { of: best.id, method: 'text', similarity: Math.round(best.s * 1000) / 1000 }
      await tx.update(documents).set({ nearDupOf: best.id }).where(eq(documents.id, doc.id))
    }
  }
}

/**
 * Writes accepted drafts as unverified events + evidence. On reprocessing, the same fact (type + quote hash) keeps its
 * event id (so Radar keys and links stay stable); facts no longer found are withdrawn, never deleted; events a person
 * already acted on are left untouched.
 */
async function persistEvents(tx: Tx, doc: typeof documents.$inferSelect, drafts: DraftEvent[], pages: PageRead[], humanAttached: boolean) {
  const prior = await tx.select({ id: events.id, eventType: events.eventType, status: events.verificationStatus }).from(events)
    .where(and(eq(events.documentId, doc.id), isNull(events.withdrawnAt), ne(events.extractionMethod, 'manual')))
  const ids = prior.map((p) => p.id)
  const touched = new Set(ids.length ? (await tx.select({ id: verifications.eventId }).from(verifications).where(inArray(verifications.eventId, ids))).map((v) => v.id) : [])
  const firstHash = new Map<string, string>()
  if (ids.length) for (const e of await tx.select({ id: evidence.eventId, h: evidence.quoteSha256 }).from(evidence).where(inArray(evidence.eventId, ids)).orderBy(evidence.createdAt)) if (!firstHash.has(e.id)) firstHash.set(e.id, e.h ?? '')
  const byFact = new Map(prior.map((p) => [`${p.eventType}|${firstHash.get(p.id)}`, p]))
  const reused = new Set<string>()
  let created = 0

  for (const d of drafts) {
    const same = byFact.get(`${d.eventType}|${d.evidence.quoteSha256}`)
    if (same && (same.status !== 'unverified' || touched.has(same.id))) { reused.add(same.id); continue }
    const flags: Record<string, boolean> = Object.fromEntries(Object.entries(d.flags).filter(([, v]) => v)) as Record<string, boolean>
    if (humanAttached) flags.identity_warning = true
    const values = {
      eventType: d.eventType, fields: d.fields, eventDate: d.eventDate, datePrecision: d.datePrecision, dateFlags: d.dateFlags,
      documentDate: d.documentDate, extractionMethod: d.extractionMethod, flags, updatedAt: new Date(),
    }
    let eventId: string
    if (same) {
      eventId = same.id
      reused.add(same.id)
      await tx.update(events).set(values).where(eq(events.id, same.id))
      await tx.delete(evidence).where(eq(evidence.eventId, same.id))
    } else {
      ;[{ id: eventId }] = await tx.insert(events).values({
        ...values, orgId: doc.orgId, patientId: doc.patientId, encounterId: doc.encounterId, documentId: doc.id, receivedAt: doc.receivedAt,
        sourceType: 'external_document', createdByKind: 'system',
      }).returning({ id: events.id })
      created++
    }
    const page = pages.find((p) => p.pageNo === d.evidence.pageNo)
    const boxes = (page?.words ?? []).filter((w) => w.b && w.s < d.evidence.charEnd && w.e > d.evidence.charStart).map((w) => w.b!)
    const base = { orgId: doc.orgId, patientId: doc.patientId, eventId, documentId: doc.id }
    await tx.insert(evidence).values({
      ...base, pageNo: d.evidence.pageNo, charStart: d.evidence.charStart, charEnd: d.evidence.charEnd, quote: d.evidence.quote,
      quoteSha256: d.evidence.quoteSha256, bbox: boxes.length ? boxes : null,
    })
    const c = d.evidence.continuation
    if (c) await tx.insert(evidence).values({ ...base, pageNo: c.pageNo, charStart: c.charStart, charEnd: c.charEnd, quote: c.quote, quoteSha256: sha256Hex(c.quote) })
  }
  const stale = prior.filter((p) => !reused.has(p.id) && p.status === 'unverified' && !touched.has(p.id)).map((p) => p.id)
  if (stale.length) await tx.update(events).set({ withdrawnAt: new Date(), withdrawnReason: 'reprocessed', updatedAt: new Date() }).where(inArray(events.id, stale))
  return { created, updated: reused.size, withdrawn: stale.length }
}
