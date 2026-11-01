import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { PatientWorkspaceHeader } from '@/components/shell'
import { EmptyState } from '@/components/ui'
import { withOrg } from '@/db'
import { documents, events, missingRecords } from '@/db/schema'
import { HttpError } from '@/server/http'
import { assertPatientAccess, loadPatient } from '@/server/patients'
import { requireStaff } from '@/server/session'

export default async function PatientWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireStaff()
  const data = await withOrg(session.orgId, async (tx) => {
    try {
      await assertPatientAccess({ db: tx, session }, id)
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) return { denied: e.code }
      throw e
    }
    const patient = await loadPatient(tx, id)
    if (!patient) return null
    const [[docs], [open], [unverified]] = await Promise.all([
      tx.select({ n: count() }).from(documents).where(eq(documents.patientId, id)),
      tx.select({ n: count() }).from(missingRecords).where(and(eq(missingRecords.patientId, id), eq(missingRecords.mode, 'production'), inArray(missingRecords.state, ['expected', 'requested', 'received']))),
      tx.select({ n: count() }).from(events).where(and(eq(events.patientId, id), eq(events.verificationStatus, 'unverified'), isNull(events.withdrawnAt))),
    ])
    return { patient, counts: { documents: docs.n, completeness: open.n, ledger: unverified.n } }
  }).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null
    throw e
  })

  if (!data) notFound()
  if ('denied' in data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          title={data.denied === 'consent_required' ? 'No active consent for this patient' : 'Access restricted'}
          description="This record opens only with the patient's active consent. Clinicians can request time-limited break-glass access; the reason is logged and the patient and administrator are notified."
          action={<Link className="underline" href={`/break-glass/${id}`}>Request break-glass access</Link>}
        />
      </div>
    )
  }
  const p = data.patient
  return (
    <div>
      <PatientWorkspaceHeader
        patient={{
          id: p.id, initials: p.initials, name: p.name, ageYears: p.ageYears, sex: p.sex, mrn: p.mrn,
          accession: `OS·${p.id.replace(/-/g, '').slice(-6).toUpperCase()}`,
          disclosure: p.disclosure, primaryContact: p.primaryContact, minor: p.minor,
        }}
        counts={data.counts}
      />
      {children}
    </div>
  )
}
