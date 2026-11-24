import Link from 'next/link'
import { Avatar, Badge, Button, ButtonLink, EmptyState, SectionHeader, Table, type Tone } from '@/components/ui'
import { SummaryStrip } from '@/components/doctor/Groups'
import { CircleHelp, EyeOff, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { patientGlances } from '@/server/registration/doctor-overview'
import { searchPatients } from '@/server/registration/search'
import { requireStaff } from '@/server/session'

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const DISCLOSURE = {
  cleared: { label: 'Diagnosis may be discussed', short: 'May discuss', icon: <ShieldCheck />, tone: 'verified' as Tone },
  not_cleared: { label: 'Do not discuss the diagnosis with the patient', short: 'Do not discuss', icon: <EyeOff />, tone: 'conflict' as Tone },
  unknown: { label: 'Diagnosis disclosure not yet recorded: use neutral words', short: 'Neutral words', icon: <CircleHelp />, tone: 'unverified' as Tone },
} as const

/** A count: new items read as teal (new), missing papers as amber, zero stays quiet. */
const Num = ({ n, tone }: { n: number; tone?: 'new' | 'missing' }) => (
  <span className={n ? (tone === 'new' ? 'font-semibold text-setu-ink tabular-nums' : tone === 'missing' ? 'font-semibold text-amber-ink tabular-nums' : 'tabular-nums') : 'text-faint tabular-nums'}>{n}</span>
)

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const q = ((await searchParams).q ?? '').slice(0, 80)
  const desk = s.role === 'desk'
  const { rows, glance } = await withOrg(s.orgId, async (tx) => {
    const found = await searchPatients(tx, q)
    if (q.trim()) await writeAudit(tx, { orgId: s.orgId, actorId: s.staffId, actorRole: s.role, action: 'patient.search', details: { results: found.length, role: s.role } })
    return { rows: found, glance: desk ? new Map() : await patientGlances(tx, found.filter((r) => r.hasConsent).map((r) => r.id), s.orgId) }
  })
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <SectionHeader
        as="h1" kicker="Patients" title="Patients"
        description={desk ? 'The desk sees initials only. Open a record through Desk lookup, which checks who the person is first.' : 'Search by name, phone number, hospital number or record code. Each row shows what needs a look before the visit.'}
        actions={<ButtonLink href="/patients/new" icon={<UserPlus aria-hidden />}>Register a patient</ButtonLink>}
      />
      <form role="search" className="flex flex-wrap items-center gap-2" action="/patients">
        <label className="sr-only" htmlFor="q">Search patients</label>
        <span className="relative w-full max-w-lg flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-faint" />
          <input
            id="q" name="q" defaultValue={q} placeholder="Name, phone, hospital number or record code" autoComplete="off" type="search"
            className="h-12 w-full rounded-md border border-control bg-matte pr-3 pl-11 text-[16px] shadow-card placeholder:text-placeholder hover:border-faint focus:border-setu-ink"
          />
        </span>
        <Button type="submit" variant="secondary" className="h-12">Search</Button>
        {q && <Link className="inline-flex h-11 items-center px-3 text-sm font-medium text-setu-ink underline decoration-link underline-offset-4" href="/patients">Clear</Link>}
      </form>
      {!desk && rows.length > 0 && (() => {
        const gs = rows.map((r) => glance.get(r.id)).filter(Boolean) as NonNullable<ReturnType<typeof glance.get>>[]
        return (
          <SummaryStrip
            label="This list at a glance"
            cols={4}
            items={[
              { label: q ? 'Matches' : 'Patients listed', value: rows.length, tone: 'neutral', sub: q ? `For “${q}”` : 'Most recently registered first' },
              { label: 'New papers since a visit', value: gs.filter((g) => g.lastSealed && g.newSinceSeal > 0).length, tone: 'setu', sub: 'Sealed before, new items since' },
              { label: 'Papers missing', value: gs.filter((g) => g.notInFile > 0).length, tone: 'unverified', sub: 'At least one paper not in file' },
              { label: 'No visit sealed yet', value: gs.filter((g) => !g.lastSealed).length, tone: 'neutral', sub: 'First visit still open' },
            ]}
          />
        )
      })()}
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
                  <td className="relative">
                    <div className="flex items-center gap-3">
                    <Avatar name={masked ? r.initials : r.name} initials={r.initials} size="sm" />
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {r.unreadable
                        ? <span className="text-[15px] font-medium text-madder-ink" data-testid="unreadable-row">{r.name}</span>
                        : <Link href={href} className={`after:absolute after:inset-0 ${masked ? 'font-display text-lg underline decoration-link underline-offset-4' : 'text-[15px] font-medium text-ink underline decoration-link underline-offset-4'}`}>{masked ? r.initials : r.name}</Link>}
                      {!masked && r.minor && <Badge tone="unverified">Minor</Badge>}
                      {!masked && r.deceased && <Badge tone="shadow">Deceased</Badge>}
                      {!desk && !r.hasConsent && !r.unreadable && <Badge tone="shadow">No consent on file</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-faint">
                      {r.accession}
                      {!desk && <span title={D.label}><Badge tone={D.tone} icon={D.icon}><span aria-hidden>{D.short}</span><span className="sr-only">{D.label}</span></Badge></span>}
                    </p>
                    </div>
                    </div>
                  </td>
                  {!desk && (
                    <>
                      <td className="whitespace-nowrap">{r.hasConsent ? `${r.ageYears ?? '—'} · ${r.sex}` : '—'}</td>
                      <td className="text-right">{g ? (g.lastSealed ? <Num n={g.newSinceSeal} tone="new" /> : <span className="text-[13px] text-muted"><Num n={g.newSinceSeal} /> on file, first visit</span>) : '—'}</td>
                      <td className="text-right">{g ? <Num n={g.notInFile} tone="missing" /> : '—'}</td>
                      <td className="text-[14px] whitespace-nowrap">{g ? (g.lastSealed ? DATE.format(g.lastSealed) : 'Not yet') : '—'}</td>
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
