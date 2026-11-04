// Read models for the documents screens and the status route. Must run inside withOrg + after access checks.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documentFiles, documentPages, documents, events, evidence } from '@/db/schema'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import evalReport from '../../../data/eval/report.json'
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
}

function summary(d: DocRow, counts: { events: number; verified: number }, lateReceived: boolean): DocSummary {
  const gate = d.flags.gate as { rejected?: number } | undefined
  return {
    id: d.id, title: d.docType ? staffDocLabel(d.docType as DocType) : d.status === 'quarantined' ? 'Quarantined file' : 'Document',
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
  }
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
  const progress = {
    documents: live.length,
    pagesReceived: live.reduce((a, d) => a + pagesOf(d), 0),
    pagesProcessed: processed.reduce((a, d) => a + pagesOf(d), 0),
    pagesVerified: verifiedDocs.reduce((a, d) => a + pagesOf(d), 0),
    inQueue: live.filter((d) => d.status === 'queued' || d.status === 'processing').length,
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
  const pages = await tx.select().from(documentPages).where(eq(documentPages.documentId, d.id)).orderBy(asc(documentPages.pageNo))
  const files = await tx.select({ id: documentFiles.id, kind: documentFiles.kind, pageNo: documentFiles.pageNo, mime: documentFiles.mime }).from(documentFiles)
    .where(eq(documentFiles.documentId, d.id))
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
