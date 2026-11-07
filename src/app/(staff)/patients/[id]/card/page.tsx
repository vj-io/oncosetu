import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { Notice } from '@/components/registration/Notice'
import { QrCard } from '@/components/registration/QrCard'
import { SectionHeader } from '@/components/ui'
import { patients } from '@/db/schema'
import { brandFor } from '@/core/copy'
import { accession } from '@/server/registration/http'
import { withPatientAccess } from '@/server/registration/page'

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await withPatientAccess(id, async (tx) => (await tx.select({ d: patients.disclosureStatus, revoked: patients.tokenRevokedAt }).from(patients).where(eq(patients.id, id)))[0])
  if (p === undefined) notFound()
  if (!p) return null
  const brand = brandFor(p.d)
  return (
    <section className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-6 py-8">
      <SectionHeader kicker="Identity card" title="Records card" description="The QR code only says who the patient is. It never opens the record: a code sent to the main contact is always asked for." />
      {p.d !== 'cleared' && (
        <Notice title={`The card shows the brand "${brand}"`}>Disclosure is not cleared, so nothing on the card names the service or the hospital in a way that hints at a diagnosis.</Notice>
      )}
      {p.revoked && <Notice tone="conflict" title="The current card was revoked">Issue a replacement below.</Notice>}
      <QrCard patientId={id} brand={brand} accession={accession(id)} />
    </section>
  )
}
