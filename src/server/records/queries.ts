// Reads and writes for "All records". Run inside withPatientAccess / a route's transaction.
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { documentFiles, documentPages, documents, events } from '@/db/schema'
import { staffDocLabel } from '@/core/copy'
import { DOC_TYPES, type DocType } from '@/core/types'
import { HttpError } from '../http'
import { fieldValues } from '../ledger/core'
import { documentLinks } from './schema'
import {
  betterHeadline, collapseStudyParts, reportTerms, resolvePairs, sortRecords, toRecordRow,
  type DocLike, type ModalityKey, type RecordRow, type RejectedPair, type ReportCandidate, type ResolvedPair, type ScanCandidate, type StoredLink,
} from './core'

const docLabel = (t: string) => ((DOC_TYPES as readonly string[]).includes(t) ? staffDocLabel(t as DocType) : 'Document')
const FILED = ['auto', 'attached'] as const

/** Source fields in the order a reader would want them as a one-line summary of a paper. The hospital's own name is never a summary. */
const SUMMARY_FIELDS = ['section_text', 'procedure_text', 'treatment_text', 'marker_text', 'margins_text', 'addendum_text', 'history_text', 'test_name', 'test_names', 'medication_names', 'allergy_text', 'appointment_text', 'referred_to_text', 'department_text', 'doctor_name', 'document_title']
function summaryLine(f: Record<string, string | number | string[]>): { rank: number; text: string } | null {
  const txt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)).trim()
  const cycle = f.cycle_number !== undefined ? `Cycle ${f.cycle_number}` : null
  const regimen = txt(f.regimen_text)
  if (cycle || regimen) return { rank: 0, text: [cycle, regimen].filter(Boolean).join(' · ').slice(0, 140) }
  for (let i = 0; i < SUMMARY_FIELDS.length; i++) { const t = txt(f[SUMMARY_FIELDS[i]]); if (t) return { rank: i + 1, text: t.slice(0, 140) } }
  return null
}

export type RecordsData = {
  rows: RecordRow[]
  pairs: ResolvedPair[]
  /** Pairs a person turned down, so the screen can say so and offer an undo. */
  rejected: RejectedPair[]
  /** Papers waiting for records staff to say whose they are: counted, never listed here. */
  held: number
  /** How many of the held papers are scans. */
  heldScans: number
}

/** The filed papers of one patient, newest first, with scan-to-report pairs. Held, rejected, detached and quarantined papers are left out. */
export async function loadRecords(tx: Tx, patientId: string): Promise<RecordsData> {
  const all = await tx.select().from(documents).where(eq(documents.patientId, patientId))
  const filed = all.filter((d) => (FILED as readonly string[]).includes(d.attachState) && d.status !== 'quarantined' && !d.duplicateOf)
  const heldDocs = all.filter((d) => d.attachState === 'pending_decision' && d.status !== 'quarantined' && !d.duplicateOf)
  const held = heldDocs.length
  const heldScans = heldDocs.filter((d) => !!(d.flags as { imaging?: unknown } | null)?.imaging).length
  const ids = filed.map((d) => d.id)
  if (!ids.length) return { rows: [], pairs: [], rejected: [], held, heldScans }

  const [evs, files, links] = await Promise.all([
    tx.select({ documentId: events.documentId, status: events.verificationStatus, fields: events.fields, flags: events.flags, createdAt: events.createdAt }).from(events)
      .where(and(inArray(events.documentId, ids), isNull(events.withdrawnAt))).orderBy(asc(events.createdAt)),
    tx.select({ documentId: documentFiles.documentId, pageNo: documentFiles.pageNo }).from(documentFiles)
      .where(and(inArray(documentFiles.documentId, ids), eq(documentFiles.kind, 'page_image'), isNull(documentFiles.supersededAt))),
    tx.select().from(documentLinks).where(and(eq(documentLinks.patientId, patientId), eq(documentLinks.kind, 'scan_report'))),
  ])
  const facts = new Map<string, { n: number; ok: number; late: boolean; first: { rank: number; text: string } | null }>()
  for (const e of evs) {
    if (!e.documentId) continue
    const c = facts.get(e.documentId) ?? { n: 0, ok: 0, late: false, first: null }
    c.n++
    if (e.status !== 'unverified') c.ok++
    if (e.flags?.late_received) c.late = true
    const h = summaryLine(fieldValues(e.fields ?? {}))
    if (h) c.first = betterHeadline(c.first, h)
    facts.set(e.documentId, c)
  }
  const imgs = new Map<string, number[]>()
  for (const f of files) imgs.set(f.documentId, [...(imgs.get(f.documentId) ?? []), f.pageNo ?? 1].sort((a, b) => a - b))

  const rows = sortRecords(collapseStudyParts(filed.map((d) => {
    const c = facts.get(d.id)
    return toRecordRow(d as unknown as DocLike, { docLabel, facts: c?.n ?? 0, checked: c?.ok ?? 0, pageImages: imgs.get(d.id) ?? [], asWritten: c?.first?.text ?? null, lateReceived: c?.late ?? false })
  })))

  // Pairing: the written imaging reports are read for their heading words only.
  const scans: ScanCandidate[] = rows.filter((r) => r.scan).map((r) => ({ id: r.id, date: r.scan!.studyDate ?? r.date, institution: r.institution, modality: r.scan!.modality, bodyKey: r.scan!.bodyKey }))
  const reportRows = rows.filter((r) => r.kind === 'report' && r.docType === 'imaging_report')
  let reports: ReportCandidate[] = []
  const reportMods = new Map<string, Set<ModalityKey>>()
  if (scans.length && reportRows.length) {
    const pages = await tx.select({ documentId: documentPages.documentId, pageNo: documentPages.pageNo, text: documentPages.text }).from(documentPages)
      .where(and(inArray(documentPages.documentId, reportRows.map((r) => r.id)), isNull(documentPages.supersededAt))).orderBy(asc(documentPages.pageNo))
    const text = new Map<string, string>()
    for (const p of pages) text.set(p.documentId, `${text.get(p.documentId) ?? ''}\n${p.text}`.slice(0, 6000))
    reports = reportRows.map((r) => ({ id: r.id, date: r.date, institution: r.institution, terms: reportTerms(`${r.title}\n${text.get(r.id) ?? ''}`) }))
    for (const r of reports) reportMods.set(r.id, r.terms.modalities)
  }
  const stored: StoredLink[] = links.map((l) => ({ id: l.id, aId: l.aId, bId: l.bId, state: l.state }))
  const rowIds = new Set(rows.map((r) => r.id))
  const rejected = links.filter((l) => l.state === 'rejected' && rowIds.has(l.aId) && rowIds.has(l.bId)).map((l) => ({ scanId: l.aId, reportId: l.bId }))
  return { rows: rows.map((r) => (r.docType === 'imaging_report' ? { ...r, reportMods: [...(reportMods.get(r.id) ?? [])] } : r)), pairs: resolvePairs(scans, reports, stored), rejected, held, heldScans }
}

export const linkDecisionSchema = z.object({ scanId: z.string().uuid(), reportId: z.string().uuid(), decision: z.enum(['confirm', 'reject', 'reset']) })
export type LinkDecision = z.infer<typeof linkDecisionSchema>

/**
 * A person confirms a proposed pair or says it is not a match (also how a confirmed pair is unlinked). Only the decision is stored.
 * The scan must hold a DICOM header and both papers must be filed under this patient.
 */
export async function decideLink(tx: Tx, patientId: string, staffId: string, body: LinkDecision): Promise<{ id: string; state: 'confirmed' | 'rejected' | 'proposed'; from: string }> {
  const docs = await tx.select({ id: documents.id, flags: documents.flags, docType: documents.docType, attachState: documents.attachState })
    .from(documents).where(and(eq(documents.patientId, patientId), or(eq(documents.id, body.scanId), eq(documents.id, body.reportId))))
  const scan = docs.find((d) => d.id === body.scanId), report = docs.find((d) => d.id === body.reportId)
  if (!scan || !report || !(scan.flags as { imaging?: unknown }).imaging || (report.flags as { imaging?: unknown }).imaging) throw new HttpError(404, 'not_found', 'Not found')
  if (!(FILED as readonly string[]).includes(scan.attachState) || !(FILED as readonly string[]).includes(report.attachState)) throw new HttpError(409, 'not_filed', 'Both papers must be filed on this record first')
  const state = body.decision === 'confirm' ? 'confirmed' : body.decision === 'reset' ? 'proposed' : 'rejected'
  const [prev] = await tx.select().from(documentLinks).where(and(eq(documentLinks.aId, body.scanId), eq(documentLinks.bId, body.reportId), eq(documentLinks.kind, 'scan_report')))
  const org = (await tx.select({ orgId: documents.orgId }).from(documents).where(eq(documents.id, body.scanId)))[0].orgId
  if (prev) {
    await tx.update(documentLinks).set({ state, decidedBy: staffId, decidedAt: new Date() }).where(eq(documentLinks.id, prev.id))
    return { id: prev.id, state, from: prev.state }
  }
  const [row] = await tx.insert(documentLinks).values({ orgId: org, patientId, kind: 'scan_report', aId: body.scanId, bId: body.reportId, state, decidedBy: staffId, decidedAt: new Date() }).returning({ id: documentLinks.id })
  return { id: row.id, state, from: 'proposed' }
}
