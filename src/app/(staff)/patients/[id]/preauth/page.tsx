import { RoleRestricted } from '@/components/shell/RoleRestricted'
// Pre-authorisation file check (PM-JAY oncology packages): which documents the package asks for are in the file, for the
// hospital's insurance desk. Document completeness only, never eligibility or package choice (src/core/preauth.ts).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, CircleCheck, CircleDashed, FileQuestion } from 'lucide-react'
import { PrintButton } from '@/components/requests/PrintButton'
import { Badge, SectionHeader } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { PREAUTH_LINES, preauthFile, type PreauthLine, type PreauthRow } from '@/core/preauth'
import type { DocType } from '@/core/types'
import { listDocuments } from '@/server/pipeline/queries'
import { loadCompleteness } from '@/server/radar-ui/completeness'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Pre-auth file · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES = ['records', 'clinician', 'org_admin'] as const

/** An open missing-papers item for the same kind of document: the paper another document mentions, and where to ask for it. */
type Chase = { institution: string | null; state: string }

function Row({ r, patientId, chase }: { r: PreauthRow; patientId: string; chase: Chase | undefined }) {
  return (
    <li className="grid gap-2 border-t border-rule py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6">
      <div className="grid content-start gap-1">
        <p className="text-[16px]">{r.asked}</p>
        {r.note && <p className="text-[13px] text-faint">{r.note}</p>}
      </div>
      <div className="grid content-start gap-1.5">
        {r.status === 'in_file' && (
          <>
            <Badge tone="verified" icon={<CircleCheck />}>In the file</Badge>
            <ul className="grid gap-1 text-[14px]">
              {r.docs.slice(0, 3).map((d) => (
                <li key={d.id}>
                  <Link href={`/patients/${patientId}/documents/${d.id}`} className="inline-flex items-center gap-0.5 underline decoration-brass underline-offset-4">
                    {d.title}<ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                  <span className="text-muted">{d.institution ? ` · ${d.institution}` : ''}{d.documentDate ? ` · ${formatDateIN(d.documentDate)}` : ''}</span>
                </li>
              ))}
              {r.docs.length > 3 && <li className="text-muted">and {r.docs.length - 3} more</li>}
            </ul>
          </>
        )}
        {r.status === 'not_in_file' && (
          <>
            <Badge tone="conflict" icon={<FileQuestion />}>Not in the file</Badge>
            {chase ? (
              <p className="text-[14px]">
                On the <Link href={`/patients/${patientId}/completeness`} className="underline decoration-brass underline-offset-4">missing-papers list</Link>
                {chase.state === 'requested' ? ', already requested' : ''}{chase.institution ? <>: ask at <strong className="font-medium">{chase.institution}</strong></> : ''}.
              </p>
            ) : (
              <p className="text-[14px] text-muted print:hidden">
                Ask the family, or <Link href={`/patients/${patientId}/requests`} className="underline decoration-brass underline-offset-4">request it from the hospital that holds it</Link>.
              </p>
            )}
          </>
        )}
        {r.status === 'not_held' && <Badge tone="neutral" icon={<CircleDashed />}>Not a paper OncoSetu holds</Badge>}
      </div>
    </li>
  )
}

export default async function PreauthPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ line?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()
  const session = await requireStaff()
  if (!(ROLES as readonly string[]).includes(session.role)) return <RoleRestricted roles={[...ROLES]} role={session.role} backHref={`/patients/${id}/overview`} />
  const data = await withPatientAccess(id, async (tx, s) => ({ docs: (await listDocuments(tx, id)).rows, missing: (await loadCompleteness(tx, id, s)).open }))
  if (!data) return null // the workspace layout explains the denial
  const { docs, missing } = data
  const line: PreauthLine = PREAUTH_LINES.some((l) => l.key === sp.line) ? (sp.line as PreauthLine) : 'chemotherapy'
  const inFile = docs.filter((d) => !d.flags.detached && !d.flags.quarantined && d.attachState !== 'rejected' && d.attachState !== 'pending_decision')
    .map((d) => ({ id: d.id, docType: d.docType as DocType | null, documentDate: d.documentDate, institution: d.institution, title: d.title }))
  const f = preauthFile(line, inFile)
  const open = missing.filter((m) => m.state === 'expected' || m.state === 'requested')
  const chaseFor = (r: PreauthRow): Chase | undefined => {
    const m = r.status === 'not_in_file' ? open.find((x) => x.expectedTypes.some((t) => r.accepts.includes(t))) : undefined
    return m && { institution: m.trigger?.institution ?? null, state: m.state }
  }
  const meta = PREAUTH_LINES.find((l) => l.key === line)!
  return (
    <div className="grid gap-6 py-8">
      <SectionHeader
        kicker="For the insurance desk · PM-JAY oncology packages"
        title="Pre-authorisation file"
        description="The documents a PM-JAY cancer package asks for before pre-authorisation and for the claim, and which of them are in this patient's file. It checks that a document of that kind is here, not what it says, and it does not choose a package."
        actions={<PrintButton label="Print this list" />}
      />
      <nav aria-label="Treatment" className="flex flex-wrap gap-2 print:hidden">
        {PREAUTH_LINES.map((l) => (
          <Link key={l.key} href={`/patients/${id}/preauth?line=${l.key}`} aria-current={l.key === line ? 'page' : undefined}
            className={`border px-3 py-1.5 text-[14px] ${l.key === line ? 'border-ink bg-ink text-matte' : 'border-rule bg-surface hover:border-ink'}`}>
            {l.label}
          </Link>
        ))}
      </nav>
      <p className="font-mono text-sm tabular-nums" data-testid="preauth-count">
        {meta.label}: {f.inFile} of {f.checkable} documents in the file
      </p>
      {(['preauth', 'claim'] as const).map((stage) => (
        <section key={stage} className="grid gap-1" aria-labelledby={`preauth-${stage}`}>
          <h2 id={`preauth-${stage}`} className="ds-kicker">{stage === 'preauth' ? 'Before pre-authorisation' : 'For the claim'}</h2>
          <ul className="grid">
            {f.rows.filter((r) => r.stage === stage).map((r) => <Row key={r.asked} r={r} patientId={id} chase={chaseFor(r)} />)}
          </ul>
        </section>
      ))}
      <p className="max-w-3xl border-t border-rule pt-4 text-[13px] text-faint">
        Source: National Health Authority, Standard Treatment Guidelines for processing oncology packages under PM-JAY, prepared with
        Tata Memorial Hospital and the National Cancer Grid ({meta.example}); treatment plan approval form: NHA FAQ. Package rules change
        and vary by package: check the current rules for each case.
      </p>
    </div>
  )
}
