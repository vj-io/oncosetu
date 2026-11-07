import Link from 'next/link'
import { Badge, ButtonLink, EmptyState, SectionHeader, Table } from '@/components/ui'
import { TourButton } from '@/components/shell/Tour'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { patientGlances } from '@/server/registration/doctor-overview'
import { searchPatients } from '@/server/registration/search'
import { requireStaff } from '@/server/session'

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const DISCLOSURE = { cleared: 'Diagnosis may be discussed', not_cleared: 'Do not discuss diagnosis', unknown: 'Not yet recorded' } as const

const Num = ({ n, hot = false }: { n: number; hot?: boolean }) => <span className={n ? (hot ? 'font-mono font-medium text-amber-ink tabular-nums' : 'font-mono tabular-nums') : 'font-mono text-faint tabular-nums'}>{n}</span>

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const q = ((await searchParams).q ?? '').slice(0, 80)
  const desk = s.role === 'desk'
  const { rows, glance } = await withOrg(s.orgId, async (tx) => {
    const found = await searchPatients(tx, q)
    if (q.trim()) await writeAudit(tx, { orgId: s.orgId, actorId: s.staffId, actorRole: s.role, action: 'patient.search', details: { results: found.length, role: s.role } })
    return { rows: found, glance: desk ? new Map() : await patientGlances(tx, found.filter((r) => r.hasConsent).map((r) => r.id)) }
  })
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <SectionHeader
        as="h1" kicker="Patients" title="Patients"
        description={desk ? 'The desk sees initials only. Open a record through Desk lookup, which checks who the person is first.' : 'Search by name, phone number, hospital number or record code. Each row shows what needs a look before the visit.'}
        actions={<><TourButton /><ButtonLink href="/patients/new">Register a patient</ButtonLink></>}
      />
      <form role="search" className="flex flex-wrap gap-2" action="/patients">
        <label className="sr-only" htmlFor="q">Search patients</label>
        <input
          id="q" name="q" defaultValue={q} placeholder="Name, phone, hospital number or record code" autoComplete="off"
          className="h-11 w-full max-w-md rounded-xs border border-rule border-b-control bg-matte px-3 text-[15px] focus:border-ink"
        />
        <button className="h-11 border border-obsidian px-5 font-mono text-xs tracking-[0.14em] uppercase hover:bg-spotlight">Search</button>
        {q && <Link className="inline-flex h-11 items-center px-3 text-sm underline" href="/patients">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? 'No patient matches' : 'No patients registered yet'} description={q ? 'Check the spelling, or try the phone number or hospital number.' : 'Register the first patient to start a record.'} />
      ) : (
        <Table caption={q ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'Most recently registered'}>
          <thead>
            <tr>
              <th>Patient</th>
              {!desk && <><th>Age · sex</th><th className="text-right">Documents</th><th className="text-right">Papers not in file</th><th className="text-right">New since last seal</th><th>Last sealed</th></>}
              <th>Diagnosis may be discussed?</th><th>Consent</th><th>Record code</th><th className="relative"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = glance.get(r.id)
              return (
                <tr key={r.id}>
                  <td>{desk || !r.hasConsent ? <span className="font-display text-lg">{r.initials}</span> : <span>{r.name}{r.minor && <> <Badge tone="unverified">Minor</Badge></>}{r.deceased && <> <Badge tone="shadow">Deceased</Badge></>}</span>}</td>
                  {!desk && (
                    <>
                      <td>{r.hasConsent ? `${r.ageYears ?? '—'} · ${r.sex}` : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.documents} /> : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.notInFile} hot /> : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.newSinceSeal} hot /> : '—'}</td>
                      <td className="font-mono text-xs whitespace-nowrap">{g ? (g.lastSealed ? DATE.format(g.lastSealed) : 'Not yet') : '—'}</td>
                    </>
                  )}
                  <td><Badge tone={r.disclosure === 'cleared' ? 'verified' : r.disclosure === 'not_cleared' ? 'conflict' : 'unverified'}>{DISCLOSURE[r.disclosure]}</Badge></td>
                  <td>{r.hasConsent ? <Badge tone="verified">On file</Badge> : <Badge tone="shadow">None</Badge>}</td>
                  <td className="font-mono text-xs">{r.accession}</td>
                  <td><Link className="underline" href={desk ? `/desk?patient=${r.id}` : `/patients/${r.id}/overview`}>{desk ? 'Check identity' : 'Open'}</Link></td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </section>
  )
}
