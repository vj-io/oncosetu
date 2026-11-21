import Link from 'next/link'
import { ClipboardCheck, FileQuestion, Mail, PackageCheck, ScanText, Send } from 'lucide-react'
import { Badge, EmptyState, Frame, SectionHeader, Table, TONE, type Tone } from '@/components/ui'
import { withOrg } from '@/db'
import { loadRecordsQueue, QUEUE_PAGE } from '@/server/ledger/queue'
import { CHASE_PAGE, loadChaseQueue, type ChaseRow } from '@/server/radar-ui/todo'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'To do · OncoSetu' }

function Tally({ icon, n, label, tone }: { icon: React.ReactNode; n: number; label: string; tone: Tone }) {
  return (
    <span className="grid h-full content-start gap-2.5 rounded-lg border border-rule bg-surface p-4 shadow-card sm:p-5">
      <span aria-hidden className={`grid size-9 place-items-center rounded-sm [&_svg]:size-[18px] ${TONE[tone].bg} ${TONE[tone].text}`}>{icon}</span>
      <span className="font-display text-[2rem] leading-none tabular-nums">{n}</span>
      <span className="text-[15px] font-semibold">{label}</span>
    </span>
  )
}

const Num = ({ n }: { n: number }) => <span className={n ? 'tabular-nums' : 'text-faint tabular-nums'}>{n}</span>
const link = 'text-[13px] text-setu-ink underline decoration-link underline-offset-4 whitespace-nowrap font-medium'

function ChaseList({ id, title, help, empty, rows, total, action }: { id: string; title: string; help: string; empty: string; rows: ChaseRow[]; total: number; action: string }) {
  return (
    <section aria-labelledby={id} id={id.replace('-h', '')} className="grid scroll-mt-24 rounded-lg border border-rule bg-surface shadow-card">
      <header className="grid gap-0.5 px-4 pt-4 pb-3 sm:px-5">
        <div className="flex items-baseline gap-2.5">
          <h2 id={id} className="text-lg">{title}</h2>
          <span className="min-w-6 rounded-full bg-alcove px-2 text-center text-xs leading-5 font-semibold text-muted tabular-nums">{total}</span>
        </div>
        <p className="text-sm text-muted">{help}</p>
      </header>
      {rows.length ? (
        <ul className="grid divide-y divide-rule border-t border-rule">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[15px] text-ink">{r.name}</span>
                <span className="text-[14px] text-muted">{r.text}</span>
                {r.detail && <span className="text-[13px] text-faint">{r.detail}</span>}
              </span>
              <Link className={link} href={r.href}>{action}</Link>
            </li>
          ))}
        </ul>
      ) : <p className="border-t border-rule px-4 py-4 text-sm text-muted sm:px-5">{empty}</p>}
      {total > rows.length && <p className="border-t border-rule px-4 py-3 text-sm text-muted sm:px-5">Showing the first {CHASE_PAGE} of {total}.</p>}
    </section>
  )
}

/** Cross-patient work queue for records staff (FR-ONB-01, FR-VER-02). Administrative priority by document type only. */
export default async function RecordsQueuePage() {
  const session = await requireStaff(['records'])
  const { rows, totals, withoutConsent, buckets, chase } = await withOrg(session.orgId, async (tx) => ({ ...(await loadRecordsQueue(tx)), chase: await loadChaseQueue(tx, session.orgId) }))

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader
        as="h1"
        kicker="Records · to do"
        title="What is waiting for you"
        description="Papers to ask for, letters that need a reminder, papers that arrived, and files that need checking. Each line opens the place where you can finish it. The order is for filing only, never a judgement of importance."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <a href="#to-ask" className="block rounded-lg"><Tally tone="unverified" icon={<Mail />} n={chase.counts.toAsk} label="Papers to ask for" /></a>
        <a href="#reminders" className="block rounded-lg"><Tally tone="setu" icon={<Send />} n={chase.counts.reminders} label="Letter reminder due" /></a>
        <a href="#arrived" className="block rounded-lg"><Tally tone="verified" icon={<PackageCheck />} n={chase.counts.arrived} label="Arrived: confirm it closes the item" /></a>
        <Tally tone="conflict" icon={<FileQuestion />} n={totals.identity} label="Whose document is it?" />
        <Tally tone="shadow" icon={<ScanText />} n={totals.lowConfidence} label="Hard-to-read pages" />
        <Tally tone="patient" icon={<ClipboardCheck />} n={totals.unverified} label="Not yet checked" />
      </div>

      <ChaseList id="to-ask-h" title="Papers to ask for" help="Another paper mentions these, and we do not have them. Open one to make the request letter." empty="No paper is waiting to be asked for." rows={chase.toAsk} total={chase.counts.toAsk} action="Make the letter" />
      <ChaseList id="reminders-h" title="Letter reminder due" help="The letter was given to the hospital a week or more ago and nothing has come back." empty="No letter needs a reminder." rows={chase.reminders} total={chase.counts.reminders} action="Open the letter" />
      <ChaseList id="arrived-h" title="Arrived: confirm it closes the item" help="A paper came in that may be the one we asked for. It stays open until you confirm or set it aside." empty="No arrived paper is waiting for you." rows={chase.arrived} total={chase.counts.arrived} action="Check and confirm" />
      {chase.withoutConsent > 0 && <p className="text-sm text-muted">{chase.withoutConsent} more {chase.withoutConsent === 1 ? 'patient has' : 'patients have'} papers to chase but no active consent; they are not listed and cannot be opened.</p>}

      {rows.length ? (
        <div className="grid gap-3">
        <h2 className="text-lg">Files to check</h2>
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
                  <span className="text-[12px] whitespace-nowrap text-faint">Record code {r.accession}</span>
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

      <Frame className="grid gap-1 px-5 py-4">
        <p className="text-[15px] font-semibold">Second look at a sample</p>
        <p className="text-[15px] text-muted">
          Each week a small sample of what records staff have checked is looked at again by a second person, and how often they disagree is reported to the administrators.
        </p>
      </Frame>
    </div>
  )
}
