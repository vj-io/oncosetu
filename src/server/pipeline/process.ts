// Postgres-backed processing state machine (ADR-001a; no queue). A runner claims a document with an atomic UPDATE,
// advances documents.stage received → text → classified → identity → extracted → gate → completeness and ends in
// done | needs_review | failed | quarantined | unreadable. A lock older than 3 minutes is re-claimable, so the status
// poll (GET /api/documents/[id]/status) or "reprocess" restarts a runner that died.
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { withOrg, type Tx } from '@/db'
import { aiRuns, documentFiles, documentPages, documents, events, evidence, patientAliases, patients, verifications } from '@/db/schema'
import { sha256Hex } from '@/core/hash'
import { decideIdentity, type PatientIdentity } from '@/core/identity'
import { writeAudit } from '@/server/audit'
import { decryptBytes, decryptField } from '@/server/crypto'
import { storeFile } from '@/server/files'
import { log } from '@/server/log'
import { activeConsent } from '@/server/patients'
import { llmExtractor, type AiRunRecord } from '@/server/ai/extract'
import { aiAllowed } from '@/server/ai/provider'
import { classify, extractCandidates, gateAndDate, identify, injectionReport, rejectionLog, type DraftEvent } from './core'
import { recomputeRadar } from './radar'
import { textSimilarity } from './safety'
import { IMAGE_PROCESSOR, readPages, type PageRead } from './text'

export const STAGES = ['received', 'text', 'classified', 'identity', 'extracted', 'gate', 'completeness'] as const
export type Stage = (typeof STAGES)[number]
export const MAX_ATTEMPTS = 3
export const STALE_LOCK_MINUTES = 3

class Abort extends Error {}

/** Atomic claim: queued, or processing with a stale lock. Returns null if another runner has it (or it is finished). */
export async function claimDocument(orgId: string, documentId: string): Promise<{ id: string; attempts: number } | null> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE documents SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id = ${documentId} AND (status = 'queued' OR (status = 'processing' AND locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES})))
      RETURNING id, attempts`)
    const r = (rows as unknown as { id: string; attempts: number }[])[0]
    return r ? { id: r.id, attempts: Number(r.attempts) } : null
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Claim + process with retries and backoff (E-DOC-20). Never throws. */
export async function runDocument(documentId: string, orgId: string, opts: { password?: string } = {}): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const claim = await claimDocument(orgId, documentId)
    if (!claim) return
    try {
      await processClaimed(orgId, documentId, opts)
      return
    } catch (err) {
      const final = claim.attempts >= MAX_ATTEMPTS
      log.error('pipeline.stage_failed', { documentId, attempt: claim.attempts, final, err })
      await withOrg(orgId, (tx) => tx.update(documents).set({
        status: final ? 'failed' : 'queued', lockedAt: null, lastError: err instanceof Abort ? err.message : 'processing_error', updatedAt: new Date(),
      }).where(and(eq(documents.id, documentId), eq(documents.status, 'processing')))).catch(() => {})
      if (final || err instanceof Abort) return
      await sleep(1000 * 2 ** i)
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

async function processClaimed(orgId: string, documentId: string, opts: { password?: string }) {
  const loaded = await withOrg(orgId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId))
    const [file] = await tx.select().from(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'original')))
    return doc && file ? { doc, bytes: decryptBytes(Buffer.from(file.bytesEnc), file.dekWrapped) } : null
  })
  if (!loaded) throw new Abort('original_missing')
  const { doc, bytes } = loaded
  const { patientId } = doc
  const flags: Record<string, unknown> = { ...doc.flags }
  for (const k of ['password_required', 'password_incorrect', 'unreadable_reason', 'injection', 'language_unsupported', 'mixed_document', 'gate', 'extraction', 'consent_withdrawn']) delete flags[k]

  if ((doc.flags.file as { storedOnly?: boolean } | undefined)?.storedOnly) return processStored(orgId, doc, flags)

  // ── text ──
  await consentStillActive(orgId, documentId, patientId)
  await setStage(orgId, documentId, 'text')
  const read = await readPages(new Uint8Array(bytes), doc.mime, opts.password)
  if (read.kind !== 'pages') {
    if (read.kind === 'needs_password') {
      flags.password_required = true
      if (read.incorrect) flags.password_incorrect = true
    } else flags.unreadable_reason = read.reason
    await withOrg(orgId, async (tx) => {
      await tx.update(documents).set({ status: 'unreadable', lockedAt: null, flags, lastError: read.kind === 'needs_password' ? 'needs_password' : read.reason, updatedAt: new Date() }).where(eq(documents.id, documentId))
      await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'document.unreadable', targetType: 'document', targetId: documentId, details: { reason: read.kind === 'needs_password' ? 'needs_password' : read.reason } })
    })
    return
  }
  const pages = read.pages
  const injection = injectionReport(pages)
  if (injection.flagged) flags.injection = injection
  await withOrg(orgId, (tx) => savePages(tx, doc, pages, flags))
  await consentStillActive(orgId, documentId, patientId)

  // ── classified ──
  await setStage(orgId, documentId, 'classified')
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
  await consentStillActive(orgId, documentId, patientId)

  // ── extracted ──
  await setStage(orgId, documentId, 'extracted')
  const runs: AiRunRecord[] = []
  const ai = await withOrg(orgId, (tx) => aiAllowed(tx, orgId, patientId))
  const ex = await extractCandidates(classified, ai.provider ? llmExtractor(ai.provider, runs) : null, { augmentRules: ai.provider?.provider === 'google' })
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
  await consentStillActive(orgId, documentId, patientId)

  // ── gate ──
  const { gate, drafts } = gateAndDate(ex.candidates, classified, ident.id, doc.receivedAt, ex.method)
  const reasons: Record<string, number> = {}
  for (const r of gate.rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1
  flags.gate = { candidates: ex.candidates.length, accepted: gate.accepted.length, kept: drafts.length, rejected: gate.rejected.length, reasons, rejections: rejectionLog(gate.rejected) }
  const counts = await withOrg(orgId, (tx) => persistEvents(tx, doc, drafts, pages, ident.attachState === 'attached'))
  await consentStillActive(orgId, documentId, patientId)

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
    await tx.update(documents).set({ status, lockedAt: null, lastError: null, flags, updatedAt: new Date() }).where(eq(documents.id, documentId))
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
