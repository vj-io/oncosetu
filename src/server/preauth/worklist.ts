// Insurance-desk worklist across patients (FR-REQ-07): for each PM-JAY treatment line, how many of the documents a package
// asks for before pre-authorisation are in the patient's file (src/core/preauth.ts). Document completeness only. Same
// consent rule as the records queue: patients without an active 'store' consent are counted, never named.
import { and, inArray, isNull, notInArray } from 'drizzle-orm'
import { PREAUTH_LINES, preauthSummary, type FileDoc, type PreauthLineSummary } from '@/core/preauth'
import type { DocType } from '@/core/types'
import type { Tx } from '@/db'
import { documents, events } from '@/db/schema'
import { decryptField } from '../crypto'
import { accession } from '../admin/format'
import { peopleWithConsent, QUEUE_PAGE } from '../ledger/queue'

export type PreauthWorkRow = { patientId: string; name: string; accession: string; mrn: string | null; documents: number; lines: PreauthLineSummary[]; missing: number }

export async function loadPreauthWorklist(tx: Tx, limit = QUEUE_PAGE): Promise<{ rows: PreauthWorkRow[]; patients: number; withoutConsent: number }> {
  const [docs, labs] = await Promise.all([
    tx.select({ id: documents.id, patientId: documents.patientId, docType: documents.docType, documentDate: documents.documentDate, institution: documents.institutionName })
      .from(documents).where(and(inArray(documents.attachState, ['auto', 'attached']), notInArray(documents.status, ['quarantined', 'failed']))),
    tx.select({ documentId: events.documentId, fields: events.fields }).from(events)
      .where(and(inArray(events.eventType, ['lab_report_documented', 'lab_results_documented']), isNull(events.withdrawnAt))),
  ])
  const labNames = new Map<string, string[]>()
  for (const e of labs) {
    if (!e.documentId) continue
    const f = e.fields as { test_name?: unknown; test_names?: unknown }
    labNames.set(e.documentId, [...(labNames.get(e.documentId) ?? []), ...[f.test_name, ...(Array.isArray(f.test_names) ? f.test_names : [])].filter((x): x is string => typeof x === 'string')])
  }
  const byPatient = new Map<string, FileDoc[]>()
  for (const d of docs) {
    const file: FileDoc = { id: d.id, docType: d.docType as DocType | null, documentDate: d.documentDate, institution: d.institution, title: '', labNames: labNames.get(d.id) }
    byPatient.set(d.patientId, [...(byPatient.get(d.patientId) ?? []), file])
  }
  const ids = [...byPatient.keys()]
  if (!ids.length) return { rows: [], patients: 0, withoutConsent: 0 }
  const { people, consented } = await peopleWithConsent(tx, ids)
  let withoutConsent = 0
  const rows: (PreauthWorkRow & { nameEnc: string })[] = []
  for (const p of people) {
    if (p.status !== 'active') continue
    if (!consented.has(p.id)) { withoutConsent++; continue }
    const file = byPatient.get(p.id)!
    const lines = PREAUTH_LINES.map((l) => preauthSummary(l.key, file))
    rows.push({ patientId: p.id, name: '', nameEnc: p.nameEnc, accession: accession(p.id), mrn: p.mrn, documents: file.length, lines, missing: lines.reduce((a, l) => a + l.missing.length, 0) })
  }
  // Most papers still to find first: that file needs the desk soonest.
  rows.sort((a, b) => b.missing - a.missing || a.accession.localeCompare(b.accession))
  const shown = rows.slice(0, limit).map(({ nameEnc, ...r }) => ({ ...r, name: decryptField(nameEnc) }))
  return { rows: shown, patients: rows.length, withoutConsent }
}
