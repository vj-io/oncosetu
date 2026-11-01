import Link from 'next/link'
import { ClipboardCheck, FileQuestion, ScanText } from 'lucide-react'
import { Badge, EmptyState, Frame, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { loadRecordsQueue } from '@/server/ledger/queue'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Records queue · OncoSetu' }

function Tally({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <Frame className="flex items-center gap-4 px-5 py-4">
      <span aria-hidden className="text-faint [&_svg]:size-6 [&_svg]:stroke-[1.4]">{icon}</span>
      <div>
        <p className="font-display text-3xl leading-none tracking-[-0.03em] tabular-nums">{n}</p>
        <p className="ds-kicker mt-1.5">{label}</p>
      </div>
    </Frame>
  )
}

const Num = ({ n }: { n: number }) => <span className={n ? 'font-mono tabular-nums' : 'font-mono text-faint tabular-nums'}>{n}</span>
const link = 'font-mono text-[11px] tracking-[0.12em] uppercase text-setu-ink underline decoration-brass underline-offset-4 whitespace-nowrap'

/** Cross-patient work queue for records staff (FR-ONB-01, FR-VER-02). Administrative priority by document type only. */
export default async function RecordsQueuePage() {
  const session = await requireStaff(['records', 'clinician'])
  const { rows, withoutConsent, buckets } = await withOrg(session.orgId, (tx) => loadRecordsQueue(tx))
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  const unverified = sum((r) => r.unverified.reduce((a, b) => a + b, 0))

  return (
    <div className="grid grid-cols-1 gap-10">
      <SectionHeader
        as="h1"
        kicker="Records · work queue"
        title="What is waiting for a person"
        description="Documents waiting for an identity decision, pages read with low OCR confidence, and unverified items by onboarding priority (pathology and molecular first). Ordered administratively, never by clinical importance."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Tally icon={<FileQuestion />} n={sum((r) => r.identity)} label="Identity decisions" />
        <Tally icon={<ScanText />} n={sum((r) => r.lowConfidence)} label="Low-confidence pages" />
        <Tally icon={<ClipboardCheck />} n={unverified} label="Unverified items" />
      </div>

      {rows.length ? (
        <Table caption="Patients with open work">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Identity decisions</th>
              <th scope="col">Low-confidence pages</th>
              <th scope="col">Unverified, by onboarding priority</th>
              <th scope="col">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.patientId}>
                <td className="min-w-48">
                  <span className="block text-[15px] text-ink">{r.name}</span>
                  <span className="font-mono text-[12px] whitespace-nowrap text-faint">ACC. {r.accession}</span>
                  {r.mrn && <span className="block font-mono text-[12px] break-all text-faint">MRN {r.mrn}</span>}
                </td>
                <td>{r.identity ? <Link className={link} href={`/patients/${r.patientId}/documents`}>{r.identity} to decide</Link> : <Num n={0} />}</td>
                <td>{r.lowConfidence ? <Link className={link} href={`/patients/${r.patientId}/documents`}>{r.lowConfidence} pages</Link> : <Num n={0} />}</td>
                <td className="min-w-56">
                  {r.unverified.some(Boolean) ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {r.unverified.map((n, i) => n > 0 && <li key={i}><Badge tone={i === 0 ? 'unverified' : 'neutral'}>{buckets[i]} · {n}</Badge></li>)}
                    </ul>
                  ) : <Num n={0} />}
                </td>
                <td><Link className={link} href={`/patients/${r.patientId}/ledger`}>Ledger</Link></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState icon={<ClipboardCheck />} title="Nothing waiting" description="Every attached document has an identity decision and every item has been verified." />
      )}
      {withoutConsent > 0 && (
        <p className="text-sm text-muted">{withoutConsent} more {withoutConsent === 1 ? 'patient has' : 'patients have'} open items but no active consent; they are not listed and cannot be opened.</p>
      )}

      <Frame className="grid gap-1 border-l-[3px] border-l-setu px-5 py-4">
        <p className="ds-kicker">Sampling QA · FR-VER-04</p>
        <p className="text-[15px] text-muted">
          Each week 5% of items verified by records staff are re-sampled for a second review, and the disagreement rate is reported on the{' '}
          <Link href="/admin/metrics" className="text-setu-ink underline decoration-brass underline-offset-4">admin metrics page</Link> (administrators and auditors).
        </p>
      </Frame>
    </div>
  )
}
