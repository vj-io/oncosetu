// Insurance-desk worklist (FR-REQ-07): every patient's PM-JAY pre-authorisation file at a glance, the files with the
// most papers still to find first. Document completeness only, never eligibility or package choice.
import Link from 'next/link'
import { FileCheck2 } from 'lucide-react'
import { EmptyState, SectionHeader, Table } from '@/components/ui'
import { PREAUTH_LINES } from '@/core/preauth'
import { withOrg } from '@/db'
import { loadPreauthWorklist } from '@/server/preauth/worklist'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Pre-auth files · OncoSetu' }

const link = 'font-mono text-[12px] tabular-nums text-setu-ink underline decoration-brass underline-offset-4 whitespace-nowrap'

export default async function PreauthWorklistPage() {
  const session = await requireStaff(['records'])
  const { rows, patients, withoutConsent } = await withOrg(session.orgId, (tx) => loadPreauthWorklist(tx))
  return (
    <div className="grid grid-cols-1 gap-10">
      <SectionHeader
        as="h1"
        kicker="Insurance desk · PM-JAY oncology packages"
        title="Pre-authorisation files"
        description="For each patient and each kind of treatment, how many of the documents a PM-JAY package asks for before pre-authorisation are in the file. The files with the most papers still to find come first. It checks that a document of that kind is here, not what it says, and it does not choose a package."
      />
      {rows.length ? (
        <Table caption="Documents in the file before pre-authorisation, by treatment">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              {PREAUTH_LINES.map((l) => <th key={l.key} scope="col">{l.label}</th>)}
              <th scope="col">Still to find</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.patientId} data-testid="preauth-row">
                <td className="min-w-48">
                  <span className="block text-[15px] text-ink">{r.name}</span>
                  <span className="font-mono text-[12px] whitespace-nowrap text-faint">Record code {r.accession}</span>
                  {r.mrn && <span className="block font-mono text-[12px] break-all text-faint">MRN {r.mrn}</span>}
                </td>
                {r.lines.map((l) => (
                  <td key={l.line}>
                    <Link className={link} href={`/patients/${r.patientId}/preauth?line=${l.line}`} aria-label={`${PREAUTH_LINES.find((x) => x.key === l.line)!.label}: ${l.inFile} of ${l.checkable} in the file`}>
                      {l.inFile} of {l.checkable}
                    </Link>
                  </td>
                ))}
                <td className="min-w-56 text-[14px]">
                  {r.missing ? (
                    <ul className="grid gap-0.5">
                      {[...new Set(r.lines.flatMap((l) => l.missing))].map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  ) : <span className="text-muted">Nothing: every line is complete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState icon={<FileCheck2 />} title="No files yet" description="Patients appear here once a document is in their file." />
      )}
      <p className="max-w-3xl text-[13px] text-faint">
        {patients} patient{patients === 1 ? '' : 's'} with documents{withoutConsent ? `; ${withoutConsent} more without a storage consent are not listed` : ''}.
        Source: National Health Authority, Standard Treatment Guidelines for processing oncology packages under PM-JAY. Package rules change and vary by package: check the current rules for each case.
      </p>
    </div>
  )
}
