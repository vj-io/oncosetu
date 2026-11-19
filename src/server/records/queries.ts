// Reads and writes for "All records". Run inside withPatientAccess / a route's transaction.
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { documentFiles, documentPages, documents, events } from '@/db/schema'
import { staffDocLabel } from '@/core/copy'
import { DOC_TYPES, type DocType } from '@/core/types'
import { HttpError } from '../http'
import { fieldValues, headline } from '../ledger/core'
import { documentLinks } from './schema'
import {
  reportTerms, resolvePairs, sortRecords, toRecordRow,
  type DocLike, type RecordRow, type ReportCandidate, type ResolvedPair, type ScanCandidate, type StoredLink,
} from './core'

const docLabel = (t: string) => ((DOC_TYPES as readonly string[]).includes(t) ? staffDocLabel(t as DocType) : 'Document')
const FILED = ['auto', 'attached'] as const

export type RecordsData = {
  rows: RecordRow[]
  pairs: ResolvedPair[]
  /** Papers waiting for records staff to say whose they are: counted, never listed here. */
  held: number
}

/** The filed papers of one patient, newest first, with scan-to-report pairs. Held, rejected, detached and quarantined papers are left out. */
export async function loadRecords(tx: Tx, patientId: string): Promise<RecordsData> {
  const all = await tx.select().from(documents).where(eq(documents.patientId, patientId))
  const filed = all.filter((d) => (FILED as readonly string[]).includes(d.attachState) && d.status !== 'quarantined' && !d.duplicateOf)
  const held = all.filter((d) => d.attachState === 'pending_decision' && d.status !== 'quarantined' && !d.duplicateOf).length
  const ids = filed.map((d) => d.id)
  if (!ids.length) return { rows: [], pairs: [], held }

  const [evs, files, links] = await Promise.all([
    tx.select({ documentId: events.documentId, status: events.verificationStatus, fields: events.fields, flags: events.flags, createdAt: events.createdAt }).from(events)
      .where(and(inArray(events.documentId, ids), isNull(events.withdrawnAt))).orderBy(asc(events.createdAt)),
    tx.select({ documentId: documentFiles.documentId, pageNo: documentFiles.pageNo }).from(documentFiles)
      .where(and(inArray(documentFiles.documentId, ids), eq(documentFiles.kind, 'page_image'), isNull(documentFiles.supersededAt))),
    tx.select().from(documentLinks).where(and(eq(documentLinks.patientId, patientId), eq(documentLinks.kind, 'scan_report'))),
  ])
  const facts = new Map<string, { n: number; ok: number; late: boolean; first: string | null }>()
  for (const e of evs) {
    if (!e.documentId) continue
    const c = facts.get(e.documentId) ?? { n: 0, ok: 0, late: false, first: null }
    c.n++
    if (e.status !== 'unverified') c.ok++
    if (e.flags?.late_received) c.late = true
    if (!c.first) {
      const f = fieldValues(e.fields ?? {})
      c.first = headline(f)?.slice(0, 140) ?? null
    }
    facts.set(e.documentId, c)
  }
  const imgs = new Map<string, number[]>()
  for (const f of files) imgs.set(f.documentId, [...(imgs.get(f.documentId) ?? []), f.pageNo ?? 1].sort((a, b) => a - b))

  const rows = sortRecords(filed.map((d) => {
    const c = facts.get(d.id)
    return toRecordRow(d as unknown as DocLike, { docLabel, facts: c?.n ?? 0, checked: c?.ok ?? 0, pageImages: imgs.get(d.id) ?? [], asWritten: c?.first ?? null, lateReceived: c?.late ?? false })
  }))

  // Pairing: the written imaging reports are read for their heading words only.
  const scans: ScanCandidate[] = rows.filter((r) => r.scan).map((r) => ({ id: r.id, date: r.scan!.studyDate ?? r.date, institution: r.institution, modality: r.scan!.modality, bodyKey: r.scan!.bodyKey }))
  const reportRows = rows.filter((r) => r.kind === 'report' && r.docType === 'imaging_report')
  let reports: ReportCandidate[] = []
  if (scans.length && reportRows.length) {
    const pages = await tx.select({ documentId: documentPages.documentId, pageNo: documentPages.pageNo, text: documentPages.text }).from(documentPages)
      .where(and(inArray(documentPages.documentId, reportRows.map((r) => r.id)), isNull(documentPages.supersededAt))).orderBy(asc(documentPages.pageNo))
    const text = new Map<string, string>()
    for (const p of pages) text.set(p.documentId, `${text.get(p.documentId) ?? ''}\n${p.text}`.slice(0, 6000))
    reports = reportRows.map((r) => ({ id: r.id, date: r.date, institution: r.institution, terms: reportTerms(`${r.title}\n${text.get(r.id) ?? ''}`) }))
  }
  const stored: StoredLink[] = links.map((l) => ({ id: l.id, aId: l.aId, bId: l.bId, state: l.state }))
  return { rows, pairs: resolvePairs(scans, reports, stored), held }
}

export const linkDecisionSchema = z.object({ scanId: z.string().uuid(), reportId: z.string().uuid(), decision: z.enum(['confirm', 'reject']) })
export type LinkDecision = z.infer<typeof linkDecisionSchema>

/**
 * A person confirms a proposed pair or says it is not a match (also how a confirmed pair is unlinked). Only the decision is stored.
 * The scan must hold a DICOM header and both papers must be filed under this patient.
 */
export async function decideLink(tx: Tx, patientId: string, staffId: string, body: LinkDecision): Promise<{ id: string; state: 'confirmed' | 'rejected'; from: string }> {
  const docs = await tx.select({ id: documents.id, flags: documents.flags, docType: documents.docType, attachState: documents.attachState })
    .from(documents).where(and(eq(documents.patientId, patientId), or(eq(documents.id, body.scanId), eq(documents.id, body.reportId))))
  const scan = docs.find((d) => d.id === body.scanId), report = docs.find((d) => d.id === body.reportId)
  if (!scan || !report || !(scan.flags as { imaging?: unknown }).imaging || (report.flags as { imaging?: unknown }).imaging) throw new HttpError(404, 'not_found', 'Not found')
  if (!(FILED as readonly string[]).includes(scan.attachState) || !(FILED as readonly string[]).includes(report.attachState)) throw new HttpError(409, 'not_filed', 'Both papers must be filed on this record first')
  const state = body.decision === 'confirm' ? 'confirmed' : 'rejected'
  const [prev] = await tx.select().from(documentLinks).where(and(eq(documentLinks.aId, body.scanId), eq(documentLinks.bId, body.reportId), eq(documentLinks.kind, 'scan_report')))
  const org = (await tx.select({ orgId: documents.orgId }).from(documents).where(eq(documents.id, body.scanId)))[0].orgId
  if (prev) {
    await tx.update(documentLinks).set({ state, decidedBy: staffId, decidedAt: new Date() }).where(eq(documentLinks.id, prev.id))
    return { id: prev.id, state, from: prev.state }
  }
  const [row] = await tx.insert(documentLinks).values({ orgId: org, patientId, kind: 'scan_report', aId: body.scanId, bId: body.reportId, state, decidedBy: staffId, decidedAt: new Date() }).returning({ id: documentLinks.id })
  return { id: row.id, state, from: 'proposed' }
}
