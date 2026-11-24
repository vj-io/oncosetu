import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, FileQuestion, Mail, PackageCheck, ScanText, Send } from 'lucide-react'
import { Badge, BarList, ButtonLink, EmptyState, Frame, Panel, SectionHeader, SegmentBar, StatTile, Table } from '@/components/ui'
import { TODO_VIEWS, type TodoView } from '@/lib/sidebar'
import { withOrg } from '@/db'
import { loadRecordsQueue, QUEUE_PAGE } from '@/server/ledger/queue'
import { CHASE_PAGE, loadChaseQueue, type ChaseRow } from '@/server/radar-ui/todo'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'To do · OncoSetu' }

const Num = ({ n }: { n: number }) => <span className={n ? 'tabular-nums' : 'text-faint tabular-nums'}>{n}</span>
const link = 'text-[13px] text-setu-ink underline decoration-link underline-offset-4 whitespace-nowrap font-medium'

function ChaseList({ id, title, help, empty, rows, total, action, limit, moreHref }: { id: string; title: string; help: string; empty: string; rows: ChaseRow[]; total: number; action: string; limit?: number; moreHref?: string }) {
  const shown = limit ? rows.slice(0, limit) : rows
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
          {shown.map((r, i) => (
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
      {moreHref && total > shown.length
        ? <p className="border-t border-rule px-4 py-3 text-sm sm:px-5"><Link className={link} href={moreHref}>See all {total}</Link></p>
        : total > shown.length && <p className="border-t border-rule px-4 py-3 text-sm text-muted sm:px-5">Showing the first {CHASE_PAGE} of {total}.</p>}
    </section>
  )
}

/** Cross-patient work queue for records staff (FR-ONB-01, FR-VER-02). Administrative priority by document type only. */
export default async function RecordsQueuePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireStaff(['records'])
  const asked = (await searchParams).view
  const view = TODO_VIEWS.some((v) => v.view === asked) ? (asked as TodoView) : null
  const { rows, totals, withoutConsent, buckets, chase } = await withOrg(session.orgId, async (tx) => ({ ...(await loadRecordsQueue(tx)), chase: await loadChaseQueue(tx, session.orgId) }))

  const fileRows = view === 'files' ? rows : rows.slice(0, 5)
  const unchecked = buckets.map((b, i) => ({ label: b, value: rows.reduce((n, r) => n + (r.unverified[i] ?? 0), 0) }))
  const TITLE: Record<TodoView, [string, string]> = {
    ask: ['Papers to ask for', 'Another paper mentions these, and we do not have them. Open one to make the request letter.'],
    reminders: ['Letter reminders', 'The letter was given to the hospital a week or more ago and nothing has come back.'],
    arrived: ['Arrived: confirm it closes the item', 'A paper came in that may be the one we asked for. It stays open until you confirm or set it aside.'],
    files: ['Files to check', 'Patients with documents to match, pages that are hard to read, or items not yet checked against the page. Pathology first.'],
  }
  const lists = {
    ask: <ChaseList id="to-ask-h" title="Papers to ask for" help={TITLE.ask[1]} empty="No paper is waiting to be asked for." rows={chase.toAsk} total={chase.counts.toAsk} action="Make the letter" limit={view ? undefined : 3} moreHref="/records?view=ask" />,
    reminders: <ChaseList id="reminders-h" title="Letter reminder due" help={TITLE.reminders[1]} empty="No letter needs a reminder." rows={chase.reminders} total={chase.counts.reminders} action="Open the letter" limit={view ? undefined : 3} moreHref="/records?view=reminders" />,
    arrived: <ChaseList id="arrived-h" title="Arrived: confirm it closes the item" help={TITLE.arrived[1]} empty="No arrived paper is waiting for you." rows={chase.arrived} total={chase.counts.arrived} action="Check and confirm" limit={view ? undefined : 3} moreHref="/records?view=arrived" />,
  }
  const files = rows.length ? (
    <section aria-labelledby="files-h" className="grid gap-3">
      {!view && <div className="flex items-baseline justify-between gap-3"><h2 id="files-h" className="text-lg">Files to check</h2>{rows.length > fileRows.length && <Link className={link} href="/records?view=files">See all {rows.length}</Link>}</div>}
      {view && <h2 id="files-h" className="sr-only">Files to check</h2>}
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
            {fileRows.map((r) => (
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
    </section>
  ) : (
    <EmptyState icon={<ClipboardCheck />} title="Nothing waiting" description="Every document has been matched to a patient and every item has been checked." />
  )

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader
        as="h1"
        kicker={view ? 'Records · to do' : 'Records'}
        title={view ? TITLE[view][0] : 'What is waiting for you'}
        description={view ? TITLE[view][1] : 'Papers to ask for, letters that need a reminder, papers that arrived, and files that need checking. Each line opens the place where you can finish it. The order is for filing only, never a judgement of importance.'}
        actions={view ? <ButtonLink href="/records" variant="secondary" icon={<ArrowLeft aria-hidden />}>All to-do lists</ButtonLink> : undefined}
      />

      {!view && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile href="/records?view=ask" tone="unverified" icon={<Mail />} value={chase.counts.toAsk} label="Papers to ask for" sub="Mentioned, not in file" />
            <StatTile href="/records?view=reminders" tone="setu" icon={<Send />} value={chase.counts.reminders} label="Letter reminders due" sub="A week or more, no reply" />
            <StatTile href="/records?view=arrived" tone="verified" icon={<PackageCheck />} value={chase.counts.arrived} label="Arrived to confirm" sub="May close an item" />
            <StatTile href="/records?view=files" tone="conflict" icon={<FileQuestion />} value={totals.identity} label="Whose document is it?" sub="Held until a person decides" />
            <StatTile href="/records?view=files" tone="shadow" icon={<ScanText />} value={totals.lowConfidence} label="Hard-to-read pages" sub="Check the numbers on the page" />
            <StatTile href="/records?view=files" tone="patient" icon={<ClipboardCheck />} value={totals.unverified} label="Not yet checked" sub="Shown, but marked unchecked" />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Panel tint title="Chasing papers" icon={<Mail />} id="chase-mix">
              <SegmentBar label="Papers being chased" parts={[
                { label: 'To ask for', value: chase.counts.toAsk, tone: 'unverified' },
                { label: 'Reminder due', value: chase.counts.reminders, tone: 'setu' },
                { label: 'Arrived to confirm', value: chase.counts.arrived, tone: 'verified' },
              ]} />
              <p className="text-[13px] text-muted">Each part opens its own list in the sidebar.</p>
            </Panel>
            <Panel title="Not yet checked, by kind of paper" icon={<ClipboardCheck />} id="unchecked-mix" aside={rows.length ? <Link className={link} href="/records?view=files">Open the files</Link> : undefined}>
              <BarList label="Items not yet checked against the page, by kind of paper" items={unchecked.map((u, i) => ({ ...u, tone: i === 0 ? 'unverified' as const : 'setu' as const }))} />
              <p className="text-[13px] text-muted">Counted over the patients listed below. The order is for filing only.</p>
            </Panel>
          </div>
        </>
      )}

      {(!view || view === 'ask') && lists.ask}
      {(!view || view === 'reminders') && lists.reminders}
      {(!view || view === 'arrived') && lists.arrived}
      {(!view || view === 'ask' || view === 'reminders' || view === 'arrived') && chase.withoutConsent > 0 && <p className="text-sm text-muted">{chase.withoutConsent} more {chase.withoutConsent === 1 ? 'patient has' : 'patients have'} papers to chase but no active consent; they are not listed and cannot be opened.</p>}

      {(!view || view === 'files') && (
        <>
          {files}
          {totals.patients > rows.length && (
            <p className="text-sm text-muted">Showing the first {QUEUE_PAGE} of {totals.patients} patients with open work, in this order. The counts above include all of them.</p>
          )}
          {withoutConsent > 0 && (
            <p className="text-sm text-muted">{withoutConsent} more {withoutConsent === 1 ? 'patient has' : 'patients have'} open items but no active consent; they are not listed and cannot be opened.</p>
          )}
        </>
      )}

      {!view && (
        <Frame tone="tint" className="grid gap-1 px-5 py-4">
          <p className="text-[15px] font-semibold">Second look at a sample</p>
          <p className="text-[15px] text-muted">
            Each week a small sample of what records staff have checked is looked at again by a second person, and how often they disagree is reported to the administrators.
          </p>
        </Frame>
      )}
    </div>
  )
}
