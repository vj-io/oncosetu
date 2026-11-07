import Link from 'next/link'
import { and, eq, ne } from 'drizzle-orm'
import { DeskLookup, type DeskHit } from '@/components/registration/DeskLookup'
import { Badge, ButtonLink, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { patients } from '@/db/schema'
import { decryptField } from '@/server/crypto'
import { initials } from '@/server/patients'
import { todaysEncounters } from '@/server/registration/desk'
import { accession } from '@/server/registration/http'
import { requireStaff } from '@/server/session'

const TIME = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const wanted = (await searchParams).patient
  const { today, preselected } = await withOrg(s.orgId, async (tx) => {
    let hit: DeskHit | null = null
    if (wanted && UUID.test(wanted)) {
      const [p] = await tx.select({ nameEnc: patients.nameEnc }).from(patients).where(and(eq(patients.id, wanted), ne(patients.status, 'erased')))
      if (p) hit = { id: wanted, initials: initials(decryptField(p.nameEnc)), accession: accession(wanted) }
    }
    return { today: await todaysEncounters(tx, s.orgId), preselected: hit }
  })
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <SectionHeader
        as="h1" kicker="Desk · today" title="Front desk"
        description="Identify the person with the card, phone, MRN or name. The record opens only after a code is sent to the registered contact, or after consent given in person with a witness."
        actions={<ButtonLink href="/patients/new" variant="secondary">Register a new patient</ButtonLink>}
      />
      <DeskLookup preselected={preselected} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <h2 className="text-2xl tracking-[-0.025em]">Today&apos;s encounters</h2>
        {today.length === 0 ? (
          <EmptyState title="No visits yet today" description="A visit starts when a patient is identified or newly registered." />
        ) : (
          <Table caption={`${today.length} today`}>
            <thead><tr><th>Time</th><th>Patient</th><th>Visit</th><th>Started by</th><th>Status</th><th className="relative"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {today.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{TIME.format(e.startedAt)}</td>
                  <td><span className="font-display text-lg">{e.initials}</span> <span className="font-mono text-xs text-faint">{e.accession}</span></td>
                  <td>{e.type === 'onboarding' ? 'First visit' : e.type === 'returning' ? 'Returning' : 'Between visits'}</td>
                  <td>{e.startedBy}</td>
                  <td><Badge tone={e.open ? 'setu' : 'shadow'}>{e.open ? 'Open' : 'Closed'}</Badge></td>
                  <td><Link className="underline" href={`/patients/${e.patientId}/overview`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  )
}
