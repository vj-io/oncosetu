import Link from 'next/link'
import { and, eq, ne } from 'drizzle-orm'
import { DeskLookup, type DeskHit } from '@/components/registration/DeskLookup'
import { CalendarCheck, DoorOpen, Repeat, UserPlus } from 'lucide-react'
import { Avatar, Badge, ButtonLink, EmptyState, SectionHeader, StatTile, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { patients } from '@/db/schema'
import { readOrNull } from '@/server/unreadable'
import { initials } from '@/server/patients'
import { todaysEncounters } from '@/server/registration/desk'
import { accession } from '@/server/registration/http'
import { requireStaff } from '@/server/session'
import { smsAvailable } from '@/server/sms/provider'

const TIME = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const wanted = (await searchParams).patient
  const { today, preselected } = await withOrg(s.orgId, async (tx) => {
    let hit: DeskHit | null = null
    if (wanted && UUID.test(wanted)) {
      const [p] = await tx.select({ nameEnc: patients.nameEnc }).from(patients).where(and(eq(patients.id, wanted), ne(patients.status, 'erased')))
      if (p) hit = { id: wanted, initials: ((n) => (n ? initials(n) : '?'))(readOrNull(p.nameEnc, 'patient name', wanted)), accession: accession(wanted) }
    }
    return { today: await todaysEncounters(tx, s.orgId), preselected: hit }
  })
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <SectionHeader
        as="h1" kicker="Desk · today" title="Front desk"
        description={smsAvailable()
          ? 'Identify the person with the card, phone, MRN or name. A record opens only after a code is sent to the registered contact, or after consent given in person with a witness.'
          : 'Identify the person with the card, phone, MRN or name. A record opens only after consent is given in person with a witness (text messages are not set up at this clinic).'}
        actions={<ButtonLink href="/patients/new" variant="secondary" icon={<UserPlus aria-hidden />}>Register a new patient</ButtonLink>}
      />
      <DeskLookup preselected={preselected} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <h2 className="text-lg">Today&apos;s encounters</h2>
        <ul aria-label="Today at a glance" className="ds-feature rounded-2xl border border-rule p-3 shadow-card sm:p-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li><StatTile icon={<CalendarCheck />} value={today.length} label="Visits today" sub="Started at this clinic since midnight" /></li>
          <li><StatTile tone="verified" icon={<DoorOpen />} value={today.filter((e) => e.open).length} label="Open now" sub="Not closed yet" /></li>
          <li><StatTile tone="patient" icon={<UserPlus />} value={today.filter((e) => e.type === 'onboarding').length} label="First visits" sub="New to this clinic" /></li>
          <li><StatTile tone="shadow" icon={<Repeat />} value={today.filter((e) => e.type === 'returning').length} label="Returning" sub="Seen here before" /></li>
        </ul>
        {today.length === 0 ? (
          <EmptyState title="No visits yet today" description="A visit starts when a patient is identified or newly registered." />
        ) : (
          <Table caption={`${today.length} today`}>
            <thead><tr><th>Time</th><th>Patient</th><th>Visit</th><th>Started by</th><th>Status</th><th className="relative"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {today.map((e) => (
                <tr key={e.id}>
                  <td className="text-[15px] tabular-nums">{TIME.format(e.startedAt)}</td>
                  <td><span className="flex items-center gap-3"><Avatar name={e.initials} initials={e.initials} size="sm" /><span className="text-[13px] text-faint">{e.accession}</span></span></td>
                  <td>{e.type === 'onboarding' ? 'First visit' : e.type === 'returning' ? 'Returning' : 'Between visits'}</td>
                  <td>{e.startedBy}</td>
                  <td><Badge tone={e.open ? 'setu' : 'shadow'}>{e.open ? 'Open' : 'Closed'}</Badge></td>
                  <td>
                    {e.reopenable
                      ? <a className="inline-flex min-h-11 min-w-11 items-center font-medium text-setu-ink underline decoration-link underline-offset-4" href={`/desk/open/${e.patientId}`}>Open</a>
                      : <Link className="inline-flex min-h-11 min-w-11 items-center font-medium text-setu-ink underline decoration-link underline-offset-4" href={`/desk?patient=${e.patientId}`}>Verify</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  )
}
