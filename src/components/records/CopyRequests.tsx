import Link from 'next/link'
import { Badge, Table } from '@/components/ui'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import type { CopyRow } from '@/server/portal/copies'

const day = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const link = 'font-medium text-setu-ink underline decoration-link underline-offset-4'

/**
 * Papers patients asked for a copy of in the portal (copies.ts), oldest first, with the 72-hour give-by time. Shown to records
 * staff on the to-do page and to clinicians on the patients page; "Copy given" is on the paper itself.
 */
export function CopyRequests({ rows, withoutConsent, limit }: { rows: CopyRow[]; withoutConsent: number; limit?: number }) {
  if (!rows.length && !withoutConsent) return null
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <section aria-labelledby="copies-h" className="grid gap-3" data-testid="copy-requests">
      <h2 id="copies-h" className="text-lg">Copies the patient asked for</h2>
      <p className="text-sm text-muted">The patient asked in the portal for a copy of a paper they cannot open yet. Give it within 3 days (Indian Medical Council regulations 1.3.2), or clear disclosure with them; then press Copy given on the paper.</p>
      <Table caption="Copies asked for">
        <thead><tr><th scope="col">Patient</th><th scope="col">Paper</th><th scope="col">Asked</th><th scope="col">Give by</th><th scope="col">Open</th></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.documentId}>
              <td className="min-w-40">{c.name}</td>
              <td>{c.docType ? staffDocLabel(c.docType as DocType) : 'Document'}</td>
              <td className="whitespace-nowrap">{day(c.askedAt)}</td>
              <td className="whitespace-nowrap">{c.overdue ? <Badge tone="conflict">Overdue · {day(c.dueAt)}</Badge> : day(c.dueAt)}</td>
              <td><Link className={link} href={`/patients/${c.patientId}/documents/${c.documentId}`}>Open the paper</Link></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {rows.length > shown.length && <p className="text-sm text-muted">Showing the oldest {shown.length} of {rows.length}.</p>}
      {withoutConsent > 0 && <p className="text-sm text-muted">{withoutConsent} more {withoutConsent === 1 ? 'request is' : 'requests are'} from patients without an active consent; they are not listed.</p>}
    </section>
  )
}
