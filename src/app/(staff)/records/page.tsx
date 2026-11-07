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
  const session = await requireStaff(['records'])
  const { rows, withoutConsent, buckets } = await withOrg(session.orgId, (tx) => loadRecordsQueue(tx))
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  const unverified = sum((r) => r.unverified.reduce((a, b) => a + b, 0))

  return (
    <div className="grid grid-cols-1 gap-10">
      <SectionHeader
        as="h1"
        kicker="Records · to do"
        title="What is waiting for a person"
        description="Documents waiting for someone to decide whose they are, pages that were hard to read, and items not yet checked, with pathology and molecular reports first. It is a filing order, never a judgement of importance."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Tally icon={<FileQuestion />} n={sum((r) => r.identity)} label="Whose document is it?" />
        <Tally icon={<ScanText />} n={sum((r) => r.lowConfidence)} label="Hard-to-read pages" />
        <Tally icon={<ClipboardCheck />} n={unverified} label="Not yet checked" />
      </div>

      {rows.length ? (
        <Table caption="Patients with open work">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Whose document is it?</th>
              <th scope="col">Hard-to-read pages</th>
              <th scope="col">Not yet checked, pathology first</th>
              <th scope="col">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.patientId}>
                <td className="min-w-48">
                  <span className="block text-[15px] text-ink">{r.name}</span>
                  <span className="font-mono text-[12px] whitespace-nowrap text-faint">Record code {r.accession}</span>
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
                <td><Link className={link} href={`/patients/${r.patientId}/ledger`}>What’s new</Link></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState icon={<ClipboardCheck />} title="Nothing waiting" description="Every document has been matched to a patient and every item has been checked." />
      )}
      {withoutConsent > 0 && (
        <p className="text-sm text-muted">{withoutConsent} more {withoutConsent === 1 ? 'patient has' : 'patients have'} open items but no active consent; they are not listed and cannot be opened.</p>
      )}

      <Frame className="grid gap-1 border-l-[3px] border-l-setu px-5 py-4">
        <p className="ds-kicker">Second look at a sample</p>
        <p className="text-[15px] text-muted">
          Each week a small sample of what records staff have checked is looked at again by a second person, and how often they disagree is reported to the administrators.
        </p>
      </Frame>
    </div>
  )
}
