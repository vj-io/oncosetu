// Read models for the documents screens and the status route. Must run inside withOrg + after access checks.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, documentFiles, documentPages, documents, events, evidence } from '@/db/schema'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import evalReport from '../../../data/eval/report.json'
import { median } from '../admin/metrics-compute'
import { STAGES, STALE_LOCK_MINUTES, type Stage } from './process'

/** FR-ONB-01 backlog order: pathology/molecular → imaging → discharge/procedure → treatment → prescriptions → labs → other. */
export const ONBOARDING_PRIORITY: DocType[] = [
  'pathology_report', 'ihc_molecular_report', 'imaging_report', 'discharge_summary', 'procedure_note', 'chemo_daycare_record',
  'radiotherapy_summary', 'consult_note', 'prescription_printed', 'prescription_handwritten', 'lab_report', 'bill_insurance', 'other',
]
const priority = (t: string | null) => {
  const i = ONBOARDING_PRIORITY.indexOf((t ?? 'other') as DocType)
  return i < 0 ? ONBOARDING_PRIORITY.length : i
}

type DocRow = typeof documents.$inferSelect
export type DisplayStatus = DocRow['status'] | 'needs_password'
export type StageState = 'done' | 'active' | 'pending' | 'failed' | 'waiting'

export function displayStatus(d: Pick<DocRow, 'status' | 'flags'>): DisplayStatus {
  return d.status === 'unreadable' && d.flags.password_required ? 'needs_password' : d.status
}

/** Stage list for the StageTracker / status route. `waiting` = stopped for a person (identity decision). */
export function stageStates(d: Pick<DocRow, 'status' | 'stage' | 'attachState' | 'flags'>): { key: Stage; state: StageState }[] {
  const idx = Math.max(0, STAGES.indexOf((d.stage ?? 'received') as Stage))
  const terminalOk = d.status === 'done' || d.status === 'needs_review'
  return STAGES.map((key, i) => {
    let state: StageState
    if (d.status === 'quarantined') state = i === 0 ? 'failed' : 'pending'
    else if (terminalOk && d.attachState === 'pending_decision') state = i < idx ? 'done' : i === idx ? 'waiting' : 'pending'
    else if (terminalOk && (d.attachState === 'rejected' || d.attachState === 'detached')) state = i <= idx ? 'done' : 'pending'
    else if (terminalOk) state = 'done'
    else if (d.status === 'failed' || d.status === 'unreadable') state = i < idx ? 'done' : i === idx ? 'failed' : 'pending'
    else state = i < idx ? 'done' : i === idx ? 'active' : 'pending' // queued / processing
    return { key, state }
  })
}

export const STAGE_LABELS: Record<Stage, string> = {
  received: 'Received', text: 'Text', classified: 'Classified', identity: 'Identity', extracted: 'Extracted', gate: 'Evidence gate', completeness: 'Completeness',
}

/** A runner should (re)start: queued, or a processing lock older than the stale window. */
export function needsRunner(d: Pick<DocRow, 'status' | 'lockedAt'>, at = new Date()): boolean {
  return d.status === 'queued' || (d.status === 'processing' && (!d.lockedAt || at.getTime() - d.lockedAt.getTime() > STALE_LOCK_MINUTES * 60_000))
}

export type DocSummary = {
  id: string; title: string; docType: string | null; institution: string | null; documentDate: string | null; receivedAt: string
  pages: number | null; status: DisplayStatus; stage: string | null; stages: { key: Stage; state: StageState }[]
  identity: DocRow['identityResult']; identityReasons: string[]; attachState: DocRow['attachState']; events: number; verified: number; rejected: number
  flags: { lowConfidence: boolean; handwritten: boolean; injection: boolean; nearDuplicateOf: string | null; languageUnsupported: boolean; quarantined: boolean; amendmentOf: string | null; lateReceived: boolean; detached: boolean }
  needsRunner: boolean
  /** Kind of file (Report, Scan, ECG, Video, Photo) and, for imaging, what the header says. Never findings. */
  file: { kind: string; category: string; label: string; storedOnly: boolean; note: string | null } | null
  imaging: { label: string; modality: string | null; studyDate: string | null; bodyPart: string | null; institution: string | null; patientName: string | null; patientSex: string | null; patientAge: string | null; frames: number; instances: number; synthetic: boolean } | null
}

function summary(d: DocRow, counts: { events: number; verified: number }, lateReceived: boolean): DocSummary {
  const file = d.flags.file as { kind: string; category: string; label: string; storedOnly?: boolean; note?: string } | undefined
  const im = d.flags.imaging as (Record<string, unknown> & { modalityLabel: string; modalities?: string[] }) | undefined
  const gate = d.flags.gate as { rejected?: number } | undefined
  return {
    id: d.id, title: d.flags.consentForm ? ((d.flags.consentForm as { action?: string }).action === 'withdraw' ? 'Signed withdrawal of consent' : 'Signed consent form') : im ? String(im.studyLabel ?? im.modalityLabel) : file?.storedOnly ? `${file.label} file` : d.docType ? staffDocLabel(d.docType as DocType) : d.status === 'quarantined' ? 'Quarantined file' : 'Document',
    docType: d.docType, institution: d.institutionName, documentDate: d.documentDate, receivedAt: d.receivedAt.toISOString(), pages: d.pages,
    status: displayStatus(d), stage: d.stage, stages: stageStates(d), identity: d.identityResult,
    identityReasons: ((d.identityDetails?.reasons as string[] | undefined) ?? []), attachState: d.attachState,
    events: counts.events, verified: counts.verified, rejected: gate?.rejected ?? 0,
    flags: {
      lowConfidence: d.lowConfidence, handwritten: !!d.handwritten, injection: d.injectionFlag, nearDuplicateOf: d.nearDupOf,
      languageUnsupported: !!d.flags.language_unsupported, quarantined: d.status === 'quarantined', amendmentOf: d.amendmentOf, lateReceived,
      detached: d.attachState === 'detached',
    },
    needsRunner: needsRunner(d),
    file: file ? { kind: file.kind, category: file.category, label: file.label, storedOnly: !!file.storedOnly, note: file.note ?? null } : null,
    imaging: im ? {
      label: String(im.studyLabel ?? im.modalityLabel), modality: (im.modality as string | null) ?? null, studyDate: (im.studyDate as string | null) ?? null, bodyPart: (im.bodyPart as string | null) ?? null,
      institution: (im.institution as string | null) ?? null, patientName: (im.patientName as string | null) ?? null, patientSex: (im.patientSex as string | null) ?? null,
      patientAge: (im.patientAge as string | null) ?? null, frames: Number(im.frames ?? 1), instances: Number(im.instances ?? 1), synthetic: !!im.synthetic,
    } : null,
  }
}

export type RecentDoc = { pages: number; ms: number; at: number } // `at` = processed time; newest first

/**
 * FR-ONB-02 "about N min left": pages still queued × the median per-page time of recently processed documents.
 * Documents run side by side, so in a burst the per-page latency (upload → processed) overstates what is left: the
 * per-page time is capped by the median gap between consecutive completions (throughput), and never goes below one
 * page's latency. Measured on a 50-page batch: 12 pages queued, latency alone said 7 min, the rest took 75 s.
 * null when nothing is queued or there is no history yet. A page count not known yet (not read) counts as one page.
 */
// ponytail: one org-wide rate; a lone many-page document right after a burst is under-estimated.
export function minutesLeft(queuedPages: number, recent: readonly RecentDoc[]): number | null {
  const ok = recent.filter((r) => r.pages > 0 && r.ms >= 0)
  const latency = median(ok.map((r) => r.ms / r.pages))
  if (!(queuedPages > 0) || latency == null) return null
  const gap = median(ok.slice(1).map((r, i) => Math.max(0, ok[i].at - r.at) / ok[i].pages))
  const ms = Math.max(latency, queuedPages * Math.min(latency, gap ?? latency))
  return Math.max(1, Math.ceil(ms / 60_000))
}

/**
 * The org's last `limit` processed documents: pages and ms from the row being created (upload) to its
 * `document.processed` audit row. Both clocks are real time (received_at may run on the demo clock).
 */
// ponytail: a reprocessed document's later run counts from the first upload; the median absorbs the odd one.
export async function recentProcessing(tx: Tx, limit = 50): Promise<RecentDoc[]> {
  const done = await tx.select({ id: auditLog.targetId, at: auditLog.at }).from(auditLog)
    .where(eq(auditLog.action, 'document.processed')).orderBy(desc(auditLog.seq)).limit(limit)
  const ids = done.flatMap((r) => (r.id ? [r.id] : []))
  if (!ids.length) return []
  const docs = new Map((await tx.select({ id: documents.id, pages: documents.pages, createdAt: documents.createdAt }).from(documents)
    .where(inArray(documents.id, ids))).map((d) => [d.id, d]))
  return done.flatMap((r) => {
    const d = r.id ? docs.get(r.id) : undefined
    return d?.pages ? [{ pages: d.pages, ms: +r.at - +d.createdAt, at: +r.at }] : []
  })
}

/** Document index in onboarding priority order, plus the progress meter numbers (FR-ONB-01/02). */
export async function listDocuments(tx: Tx, patientId: string) {
  const docs = await tx.select().from(documents).where(eq(documents.patientId, patientId)).orderBy(desc(documents.receivedAt))
  const ids = docs.map((d) => d.id)
  const evs = ids.length ? await tx.select({ documentId: events.documentId, status: events.verificationStatus, flags: events.flags }).from(events)
    .where(and(inArray(events.documentId, ids), isNull(events.withdrawnAt))) : []
  const counts = new Map<string, { events: number; verified: number; late: boolean }>()
  for (const e of evs) {
    const c = counts.get(e.documentId!) ?? { events: 0, verified: 0, late: false }
    c.events++
    if (e.status !== 'unverified') c.verified++
    if (e.flags.late_received) c.late = true
    counts.set(e.documentId!, c)
  }
  const rows = docs.map((d) => summary(d, counts.get(d.id) ?? { events: 0, verified: 0 }, counts.get(d.id)?.late ?? false))
    .sort((a, b) => priority(a.docType) - priority(b.docType) || (b.documentDate ?? '').localeCompare(a.documentDate ?? '') || b.receivedAt.localeCompare(a.receivedAt))
  const live = docs.filter((d) => d.attachState !== 'detached' && d.attachState !== 'rejected' && d.status !== 'quarantined')
  const pagesOf = (d: DocRow) => d.pages ?? 1
  const processed = live.filter((d) => d.status === 'done' || d.status === 'needs_review' || d.status === 'unreadable')
  const verifiedDocs = processed.filter((d) => {
    const c = counts.get(d.id)
    return (c && c.events > 0 && c.verified === c.events) || (d.handwritten && d.manualTags.includes('doc_type'))
  })
  const queued = live.filter((d) => d.status === 'queued' || d.status === 'processing')
  const progress = {
    documents: live.length,
    pagesReceived: live.reduce((a, d) => a + pagesOf(d), 0),
    pagesProcessed: processed.reduce((a, d) => a + pagesOf(d), 0),
    pagesVerified: verifiedDocs.reduce((a, d) => a + pagesOf(d), 0),
    inQueue: queued.length,
    minutesLeft: queued.length ? minutesLeft(queued.reduce((a, d) => a + pagesOf(d), 0), await recentProcessing(tx)) : null,
    awaitingDecision: live.filter((d) => d.attachState === 'pending_decision' && (d.status === 'needs_review' || d.status === 'done')).length,
  }
  return { rows, progress }
}

export async function documentStatus(tx: Tx, documentId: string) {
  const [d] = await tx.select().from(documents).where(eq(documents.id, documentId))
  if (!d) return null
  const [counts] = [await tx.select({ id: events.id }).from(events).where(and(eq(events.documentId, d.id), isNull(events.withdrawnAt)))]
  return { doc: d, summary: summary(d, { events: counts.length, verified: 0 }, false) }
}

type ClassRecall = Record<string, { recall: number | null; gold: number }>
export type CoverageReport = { recallByClass?: ClassRecall; heldout?: { recallByClass?: ClassRecall } }

/**
 * FR-EXT-08: the evaluation's per-class recall, shown to verifiers as a coverage note. The held-out set (written after the
 * rule library was frozen) predicts real performance better than the tuned one, so it wins when it has the class.
 */
export function coverageFor(docType: string | null): { recall: number; gold: number } | null {
  const rep = evalReport as CoverageReport
  const cls = docType ?? 'other'
  for (const r of [rep.heldout?.recallByClass?.[cls], rep.recallByClass?.[cls]]) if (r && r.recall !== null) return { recall: r.recall, gold: r.gold }
  return null
}

/** Everything the source viewer shows for one document. */
export async function documentDetail(tx: Tx, patientId: string, documentId: string) {
  const [d] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.patientId, patientId)))
  if (!d) return null
  // FR-DOC-08: the current version of each derived artefact; superseded readings stay stored, unread here.
  const pages = await tx.select().from(documentPages).where(and(eq(documentPages.documentId, d.id), isNull(documentPages.supersededAt))).orderBy(asc(documentPages.pageNo))
  const files = await tx.select({ id: documentFiles.id, kind: documentFiles.kind, pageNo: documentFiles.pageNo, mime: documentFiles.mime }).from(documentFiles)
    .where(and(eq(documentFiles.documentId, d.id), isNull(documentFiles.supersededAt)))
  const evs = await tx.select().from(events).where(eq(events.documentId, d.id)).orderBy(asc(events.createdAt))
  const ev = evs.length ? await tx.select().from(evidence).where(inArray(evidence.eventId, evs.map((e) => e.id))) : []
  const related = [d.amendmentOf, d.nearDupOf].filter(Boolean) as string[]
  const rel = related.length ? await tx.select({ id: documents.id, docType: documents.docType, documentDate: documents.documentDate }).from(documents).where(inArray(documents.id, related)) : []
  return {
    doc: d,
    status: displayStatus(d),
    stages: stageStates(d),
    pages: pages.map((p) => ({ pageNo: p.pageNo, text: p.text, words: p.words ?? null, ocrConfidence: p.ocrConfidence, lowConfidence: p.lowConfidence, processor: p.processor })),
    pageImages: files.filter((f) => f.kind === 'page_image').map((f) => f.pageNo ?? 1),
    original: files.find((f) => f.kind === 'original') ? { mime: d.mime } : null,
    events: evs.map((e) => ({ ...e, evidence: ev.filter((x) => x.eventId === e.id) })),
    related: Object.fromEntries(rel.map((r) => [r.id, r])),
    coverage: coverageFor(d.docType),
  }
}
export type DocumentDetail = NonNullable<Awaited<ReturnType<typeof documentDetail>>>
