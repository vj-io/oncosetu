import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { BreakGlassForm } from '@/components/registration/BreakGlassForm'
import { Notice } from '@/components/registration/Notice'
import { SectionHeader } from '@/components/ui'
import { withOrg } from '@/db'
import { patients } from '@/db/schema'
import { accession } from '@/server/registration/http'
import { BREAK_GLASS_HOURS } from '@/server/registration/patient-admin'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function BreakGlassPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  const s = await requireStaff(['clinician', 'org_admin'])
  if (!UUID.test(patientId)) notFound()
  const exists = await withOrg(s.orgId, async (tx) => (await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId))).length > 0)
  if (!exists) notFound()
  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <SectionHeader as="h1" kicker={`Emergency access · record code ${accession(patientId)}`} title="Open this record without consent" />
      <Notice tone="conflict" title="This is logged and the patient is told">
        Access lasts {BREAK_GLASS_HOURS} hours. The reason you give is saved with your name, the administrator can see it, and the patient or their primary contact receives a neutral message.
      </Notice>
      <BreakGlassForm patientId={patientId} />
    </section>
  )
}
