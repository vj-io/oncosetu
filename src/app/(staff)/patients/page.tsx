import Link from 'next/link'
import { Badge, ButtonLink, EmptyState, SectionHeader, Table } from '@/components/ui'
import { CircleHelp, EyeOff, ShieldCheck } from 'lucide-react'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { patientGlances } from '@/server/registration/doctor-overview'
import { searchPatients } from '@/server/registration/search'
import { requireStaff } from '@/server/session'

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const DISCLOSURE = {
  cleared: { label: 'Diagnosis may be discussed', icon: ShieldCheck, cls: 'text-sage-ink' },
  not_cleared: { label: 'Do not discuss the diagnosis with the patient', icon: EyeOff, cls: 'text-madder-ink' },
  unknown: { label: 'Diagnosis disclosure not yet recorded: use neutral words', icon: CircleHelp, cls: 'text-faint' },
} as const

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
        actions={<ButtonLink href="/patients/new">Register a patient</ButtonLink>}
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
              {!desk && <><th>Age · sex</th><th className="text-right">New since last visit</th><th className="text-right">Missing papers</th><th>Last visit sealed</th></>}
              {desk && <th className="text-right"><span className="sr-only">Action</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = glance.get(r.id)
              const D = DISCLOSURE[r.disclosure]
              const href = desk ? `/desk?patient=${r.id}` : `/patients/${r.id}/overview`
              const masked = desk || !r.hasConsent
              return (
                <tr key={r.id}>
                  <td>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={href} className={masked ? 'font-display text-lg underline decoration-brass underline-offset-4' : 'text-[15px] font-medium text-ink underline decoration-brass underline-offset-4'}>{masked ? r.initials : r.name}</Link>
                      {!masked && r.minor && <Badge tone="unverified">Minor</Badge>}
                      {!masked && r.deceased && <Badge tone="shadow">Deceased</Badge>}
                      {!desk && !r.hasConsent && <Badge tone="shadow">No consent on file</Badge>}
                      {!desk && <span title={D.label} className={`inline-flex ${D.cls}`}><D.icon aria-hidden className="size-4" /><span className="sr-only">{D.label}</span></span>}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] tracking-[0.08em] text-faint">{r.accession}</p>
                  </td>
                  {!desk && (
                    <>
                      <td className="whitespace-nowrap">{r.hasConsent ? `${r.ageYears ?? '—'} · ${r.sex}` : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.newSinceSeal} hot /> : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.notInFile} hot /> : '—'}</td>
                      <td className="font-mono text-xs whitespace-nowrap">{g ? (g.lastSealed ? DATE.format(g.lastSealed) : 'Not yet') : '—'}</td>
                    </>
                  )}
                  {desk && <td className="text-right"><Link className="underline" href={href}>Check identity</Link></td>}
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </section>
  )
}
