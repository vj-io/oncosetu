// The records to-do list for chasing papers (finale WP3): what to ask for, which letters are due a reminder, and which
// arrivals need a person to confirm they close the item. Counts cover everyone; names appear only for patients with an
// active "store" consent. Staff wording about papers only; a person decides every closure.
import { and, eq, inArray } from 'drizzle-orm'
import { formatDateIN, staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import type { Tx } from '@/db'
import { documents, missingRecords, recordRequests } from '@/db/schema'
import { now } from '../clock'
import { decryptField } from '../crypto'
import { peopleWithConsent } from '../ledger/queue'
import { reminderPlan } from '../requests/reminders'
import { requestMissingIds } from './completeness'

export type ChaseRow = { patientId: string; name: string; text: string; detail: string | null; href: string; days?: number }
export type ChaseQueue = {
  toAsk: ChaseRow[]; reminders: ChaseRow[]; arrived: ChaseRow[]
  counts: { toAsk: number; reminders: number; arrived: number }
  withoutConsent: number
}

/** How many rows each list shows; the counts above them include everyone. */
export const CHASE_PAGE = 25

const staffText = (m: typeof missingRecords.$inferSelect): string => {
  const w = (m.matchWindow ?? {}) as { wording?: { en?: unknown } }
  return typeof w.wording?.en === 'string' ? w.wording.en : `${staffDocLabel((m.expectedTypes[0] ?? 'other') as DocType)} not in file`
}

export async function loadChaseQueue(tx: Tx, orgId: string): Promise<ChaseQueue> {
  const at = await now(orgId)
  const [items, reqs] = await Promise.all([
    tx.select().from(missingRecords).where(and(eq(missingRecords.mode, 'production'), inArray(missingRecords.state, ['expected', 'received']))),
    tx.select().from(recordRequests).where(inArray(recordRequests.state, ['sent', 'reminder_due', 'open_21d'])),
  ])
  const due = reqs.map((r) => ({ r, plan: reminderPlan(r, at) })).filter((x) => x.plan.state === 'reminder_due' || x.plan.state === 'open_21d')
  const patientIds = [...new Set([...items.map((i) => i.patientId), ...due.map((d) => d.r.patientId)])]
  const empty: ChaseQueue = { toAsk: [], reminders: [], arrived: [], counts: { toAsk: 0, reminders: 0, arrived: 0 }, withoutConsent: 0 }
  if (!patientIds.length) return empty

  const { people, consented } = await peopleWithConsent(tx, patientIds)
  const ok = new Set(people.filter((p) => p.status === 'active' && consented.has(p.id)).map((p) => p.id))
  const nameEnc = new Map(people.map((p) => [p.id, p.nameEnc]))
  const withoutConsent = patientIds.filter((id) => !ok.has(id)).length

  const proposedIds = items.filter((i) => i.state === 'received' && i.proposedDocumentId && ok.has(i.patientId)).map((i) => i.proposedDocumentId!)
  const proposed = new Map((proposedIds.length ? await tx.select({ id: documents.id, docType: documents.docType, documentDate: documents.documentDate }).from(documents).where(inArray(documents.id, proposedIds)) : []).map((d) => [d.id, d]))

  const byAge = (a: { createdAt: Date }, b: { createdAt: Date }) => +a.createdAt - +b.createdAt
  const askItems = items.filter((i) => i.state === 'expected' && ok.has(i.patientId)).sort(byAge)
  const arrItems = items.filter((i) => i.state === 'received' && ok.has(i.patientId)).sort(byAge)
  const remItems = due.filter((d) => ok.has(d.r.patientId)).sort((a, b) => +a.r.sentAt! - +b.r.sentAt!)

  const toAsk: ChaseRow[] = askItems.slice(0, CHASE_PAGE).map((i) => ({ patientId: i.patientId, name: '', text: staffText(i), detail: null, href: `/patients/${i.patientId}/completeness#m-${i.id}` }))
  const arrived: ChaseRow[] = arrItems.slice(0, CHASE_PAGE).map((i) => {
    const d = i.proposedDocumentId ? proposed.get(i.proposedDocumentId) : undefined
    return { patientId: i.patientId, name: '', text: staffText(i), detail: d ? `Arrived: ${staffDocLabel((d.docType ?? 'other') as DocType)}${d.documentDate ? `, dated ${formatDateIN(d.documentDate)}` : ''}` : null, href: `/patients/${i.patientId}/completeness#m-${i.id}` }
  })
  const reminders: ChaseRow[] = remItems.slice(0, CHASE_PAGE).map(({ r }) => {
    const days = Math.floor((+at - +r.sentAt!) / 86_400_000)
    return { patientId: r.patientId, name: '', text: `Letter to ${r.institution || 'the hospital'}: ${requestMissingIds(r).length || 1} paper${requestMissingIds(r).length > 1 ? 's' : ''} asked for`, detail: `Given to the hospital ${days} days ago, no paper yet`, days, href: `/patients/${r.patientId}/requests#r-${r.id}` }
  })
  for (const row of [...toAsk, ...arrived, ...reminders]) row.name = decryptField(nameEnc.get(row.patientId)!)
  return { toAsk, reminders, arrived, counts: { toAsk: askItems.length, reminders: remItems.length, arrived: arrItems.length }, withoutConsent }
}
