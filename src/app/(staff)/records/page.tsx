import Link from 'next/link'
import { ClipboardCheck, FileQuestion, Mail, PackageCheck, ScanText, Send } from 'lucide-react'
import { Badge, EmptyState, Frame, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { loadRecordsQueue, QUEUE_PAGE } from '@/server/ledger/queue'
import { CHASE_PAGE, loadChaseQueue, type ChaseRow } from '@/server/radar-ui/todo'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'To do · OncoSetu' }

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

function ChaseList({ id, title, help, empty, rows, total, action }: { id: string; title: string; help: string; empty: string; rows: ChaseRow[]; total: number; action: string }) {
  return (
    <section aria-labelledby={id} id={id.replace('-h', '')} className="grid scroll-mt-24 gap-3">
      <header className="flex flex-wrap items-baseline gap-x-3 border-b border-rule pb-2">
        <h2 id={id} className="text-xl tracking-[-0.02em]">{title}</h2>
        <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{total}</span>
        <span className="text-sm text-muted">{help}</span>
      </header>
      {rows.length ? (
        <ul className="grid divide-y divide-rule border-y border-rule">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[15px] text-ink">{r.name}</span>
                <span className="text-[14px] text-muted">{r.text}</span>
                {r.detail && <span className="text-[13px] text-faint">{r.detail}</span>}
              </span>
              <Link className={link} href={r.href}>{action}</Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{empty}</p>}
      {total > rows.length && <p className="text-sm text-muted">Showing the first {CHASE_PAGE} of {total}.</p>}
    </section>
  )
}

/** Cross-patient work queue for records staff (FR-ONB-01, FR-VER-02). Administrative priority by document type only. */
export default async function RecordsQueuePage() {
  const session = await requireStaff(['records'])
  const { rows, totals, withoutConsent, buckets, chase } = await withOrg(session.orgId, async (tx) => ({ ...(await loadRecordsQueue(tx)), chase: await loadChaseQueue(tx, session.orgId) }))

  return (
    <div className="grid grid-cols-1 gap-10">
      <SectionHeader
        as="h1"
        kicker="Records · to do"
        title="What is waiting for you"
        description="Papers to ask for, letters that need a reminder, papers that arrived, and files that need checking. Each line opens the place where you can finish it. The order is for filing only, never a judgement of importance."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <a href="#to-ask" className="block"><Tally icon={<Mail />} n={chase.counts.toAsk} label="Papers to ask for" /></a>
        <a href="#reminders" className="block"><Tally icon={<Send />} n={chase.counts.reminders} label="Letter reminder due" /></a>
        <a href="#arrived" className="block"><Tally icon={<PackageCheck />} n={chase.counts.arrived} label="Arrived: confirm it closes the item" /></a>
        <Tally icon={<FileQuestion />} n={totals.identity} label="Whose document is it?" />
        <Tally icon={<ScanText />} n={totals.lowConfidence} label="Hard-to-read pages" />
        <Tally icon={<ClipboardCheck />} n={totals.unverified} label="Not yet checked" />
      </div>

      <ChaseList id="to-ask-h" title="Papers to ask for" help="Another paper mentions these, and we do not have them. Open one to make the request letter." empty="No paper is waiting to be asked for." rows={chase.toAsk} total={chase.counts.toAsk} action="Make the letter" />
      <ChaseList id="reminders-h" title="Letter reminder due" help="The letter was given to the hospital a week or more ago and nothing has come back." empty="No letter needs a reminder." rows={chase.reminders} total={chase.counts.reminders} action="Open the letter" />
      <ChaseList id="arrived-h" title="Arrived: confirm it closes the item" help="A paper came in that may be the one we asked for. It stays open until you confirm or set it aside." empty="No arrived paper is waiting for you." rows={chase.arrived} total={chase.counts.arrived} action="Check and confirm" />
      {chase.withoutConsent > 0 && <p className="text-sm text-muted">{chase.withoutConsent} more {chase.withoutConsent === 1 ? 'patient has' : 'patients have'} papers to chase but no active consent; they are not listed and cannot be opened.</p>}

      {rows.length ? (
        <div className="grid gap-3">
        <h2 className="text-xl tracking-[-0.02em]">Files to check</h2>
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
        </div>
      ) : (
        <EmptyState icon={<ClipboardCheck />} title="Nothing waiting" description="Every document has been matched to a patient and every item has been checked." />
      )}
      {totals.patients > rows.length && (
        <p className="text-sm text-muted">Showing the first {QUEUE_PAGE} of {totals.patients} patients with open work, in this order. The counts above include all of them.</p>
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
