// Records Request Kit, staff tab (FR-REQ-01..05). Letters are printed and given by the patient/caregiver;
// nothing is sent to an institution automatically.
import { notFound } from 'next/navigation'
import { RequestBuilder } from '@/components/requests/RequestBuilder'
import { RequestList } from '@/components/requests/RequestList'
import { SectionHeader } from '@/components/ui'
import { can } from '@/server/rbac'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Requests · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const session = await requireStaff(['desk', 'records', 'clinician'])
  const ok = await withPatientAccess(id, async () => true)
  if (!ok) return null // the workspace layout explains the denial
  return (
    <div className="grid gap-8 py-8">
      <SectionHeader
        kicker="Records Request Kit"
        title="Requests to other hospitals"
        description="A letter in English or Hindi for the hospital's Medical Records Department, tracked from the day it is given: a reminder to the patient at 7 days, still open at 21 days with an information sheet. The 72-hour period is the regulation's reference, never a promise."
        actions={can(session.role, 'request.manage') ? <RequestBuilder patientId={id} actor="staff" disclosure="cleared" variant="primary" size="md" /> : undefined}
      />
      <RequestList patientId={id} actor="staff" />
    </div>
  )
}
