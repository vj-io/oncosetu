import Link from 'next/link'
import { Badge, ButtonLink, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { searchPatients } from '@/server/registration/search'
import { requireStaff } from '@/server/session'

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const q = ((await searchParams).q ?? '').slice(0, 80)
  const desk = s.role === 'desk'
  const rows = await withOrg(s.orgId, async (tx) => {
    const found = await searchPatients(tx, q)
    if (q.trim()) await writeAudit(tx, { orgId: s.orgId, actorId: s.staffId, actorRole: s.role, action: 'patient.search', details: { results: found.length, role: s.role } })
    return found
  })
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <SectionHeader
        as="h1" kicker="Registry" title="Patients"
        description={desk ? 'The desk sees initials only. Open a record through Desk lookup, which verifies the person first.' : 'Search by name, phone, MRN or accession code.'}
        actions={<ButtonLink href="/patients/new">Register a patient</ButtonLink>}
      />
      <form role="search" className="flex flex-wrap gap-2" action="/patients">
        <label className="sr-only" htmlFor="q">Search patients</label>
        <input
          id="q" name="q" defaultValue={q} placeholder="Name, phone, MRN or OS·ABC123" autoComplete="off"
          className="h-11 w-full max-w-md rounded-xs border border-rule border-b-control bg-matte px-3 text-[15px] focus:border-ink"
        />
        <button className="h-11 border border-obsidian px-5 font-mono text-xs tracking-[0.14em] uppercase hover:bg-spotlight">Search</button>
        {q && <Link className="inline-flex h-11 items-center px-3 text-sm underline" href="/patients">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? 'No patient matches' : 'No patients registered yet'} description={q ? 'Check the spelling, or try the phone number or MRN.' : 'Register the first patient to start a record.'} />
      ) : (
        <Table caption={q ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'Most recently registered'}>
          <thead>
            <tr><th>Patient</th><th>Accession</th>{!desk && <><th>Age · sex</th><th>MRN</th></>}<th>Disclosure</th><th>Consent</th><th>Registered</th><th className="relative"><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{desk || !r.hasConsent ? <span className="font-display text-lg">{r.initials}</span> : <span>{r.name}{r.minor && <> <Badge tone="unverified">Minor</Badge></>}{r.deceased && <> <Badge tone="shadow">Deceased</Badge></>}</span>}</td>
                <td className="font-mono text-xs">{r.accession}</td>
                {!desk && <><td>{r.hasConsent ? `${r.ageYears ?? '—'} · ${r.sex}` : '—'}</td><td className="font-mono text-xs">{r.hasConsent ? r.mrn ?? '—' : '—'}</td></>}
                <td><Badge tone={r.disclosure === 'cleared' ? 'verified' : r.disclosure === 'not_cleared' ? 'conflict' : 'unverified'}>{r.disclosure.replace('_', ' ')}</Badge></td>
                <td>{r.hasConsent ? <Badge tone="verified">Active</Badge> : <Badge tone="shadow">None active</Badge>}</td>
                <td className="font-mono text-xs">{DATE.format(r.createdAt)}</td>
                <td><Link className="underline" href={desk ? `/desk?patient=${r.id}` : `/patients/${r.id}/overview`}>{desk ? 'Verify' : 'Open'}</Link></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
