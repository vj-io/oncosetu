import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, count, eq, inArray, ne } from 'drizzle-orm'
import { PatientWorkspaceHeader } from '@/components/shell'
import { EmptyState } from '@/components/ui'
import { withOrg } from '@/db'
import { RecordErasure } from '@/components/erasure/RecordErasure'
import { documents, missingRecords } from '@/db/schema'
import { accession, istDate } from '@/server/admin/format'
import { erasureContext, loadErasure } from '@/server/erasure/erasure'
import { HttpError } from '@/server/http'
import { writeAudit } from '@/server/audit'
import { newSinceSealCounts } from '@/server/registration/doctor-overview'
import { assertPatientAccess, loadPatient } from '@/server/patients'
import { requireStaff } from '@/server/session'

export default async function PatientWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireStaff()
  const data = await withOrg(session.orgId, async (tx) => {
    try {
      await assertPatientAccess({ db: tx, session }, id)
    } catch (e) {
      if (e instanceof HttpError && e.status === 410) return { erasedAt: (await loadErasure(tx, id))?.completedAt ?? null } // J8 tombstone
      if (e instanceof HttpError && e.status === 403) {
        // Make refusals visible on the admin "Blocked and held" panel (ids and codes only).
        await writeAudit(tx, { orgId: session.orgId, actorId: session.staffId, actorRole: session.role, action: 'access.refused', targetType: 'patient', targetId: id, details: { reason: e.code } })
        const er = e.code === 'consent_required' ? await erasureContext(tx, id) : null // J8: the denial screen carries the erasure action
        return { denied: e.code, erasure: er }
      }
      throw e
    }
    const patient = await loadPatient(tx, id)
    if (!patient) return null
    const [[docs], [open], changed] = await Promise.all([
      tx.select({ n: count() }).from(documents).where(and(eq(documents.patientId, id), inArray(documents.attachState, ['auto', 'attached']), ne(documents.status, 'quarantined'))), // filed documents only, so the badge matches the list
      tx.select({ n: count() }).from(missingRecords).where(and(eq(missingRecords.patientId, id), eq(missingRecords.mode, 'production'), inArray(missingRecords.state, ['expected', 'requested', 'received']))),
      newSinceSealCounts(tx, [id]),
    ])
    return { patient, counts: { documents: docs.n, completeness: open.n, ledger: changed.get(id) ?? 0 } }
  }).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null
    throw e
  })

  if (!data) notFound()
  if ('erasedAt' in data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState title="Records erased"
          description={`Records erased on ${istDate(data.erasedAt)} at the patient's request; audit trail retained. Record ${accession(id)}.`} />
      </div>
    )
  }
  if ('denied' in data) {
    const roleLimited = data.denied === 'forbidden' || data.denied === 'break_glass_required' // a role rule, not a consent problem
    if (roleLimited) {
      const auditor = data.denied === 'forbidden'
      return (
        <div className="mx-auto max-w-2xl px-4 py-16">
          <EmptyState
            title={auditor ? 'Patient records are not part of your role' : 'Administrators open a record only with break-glass access'}
            description={auditor
              ? 'Auditors review the audit log and counts, not patient records. Use the admin console instead.'
              : 'This is a role restriction. Administrators can open a patient record only through time-limited break-glass access; the reason is logged and the patient is notified.'}
            action={<span className="flex flex-wrap gap-4">
              {!auditor && <Link className="underline" href={`/break-glass/${id}`}>Request break-glass access</Link>}
              <Link className="underline" href="/admin">Go to the admin console</Link>
            </span>}
          />
        </div>
      )
    }
    const verify = data.denied === 'verification_required'
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          title={verify ? 'Verify the patient first' : 'No active consent for this patient'}
          description={verify
            ? 'At the desk a record opens only after the patient or primary contact confirms a code, or after in-person witnessed verification.'
            : "This record opens only with the patient's active consent. Consent can be recorded again at the desk after verification. Clinicians can request time-limited break-glass access; the reason is logged and the patient and administrator are notified."}
          action={verify
            ? <Link className="underline" href="/desk">Go to the desk</Link>
            : <span className="flex flex-wrap gap-4"><Link className="underline" href="/desk">Record consent at the desk</Link><Link className="underline" href={`/break-glass/${id}`}>Request break-glass access</Link></span>}
        />
        {data.erasure && (data.erasure.withdrawn || data.erasure.erasure) && (session.role === 'records' || session.role === 'clinician') && (
          <div className="mt-6">
            <RecordErasure patientId={id} status={data.erasure.erasure ? `Erasure request ${data.erasure.erasure.state}. Eligible for removal after ${istDate(data.erasure.erasure.eligibleAfter)}.` : null} />
          </div>
        )}
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
        role={session.role}
      />
      {children}
    </div>
  )
}
