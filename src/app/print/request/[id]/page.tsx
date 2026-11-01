// Printable records request letter (FR-REQ-01/02): A4, English or Hindi. Staff of the org or the patient/caregiver.
// The patient carries this paper, so it follows FR-CON-07: brand "Setu Records" and neutral labels unless cleared.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { PrintSheet } from '@/components/requests/PrintSheet'
import { istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { withOrg } from '@/db'
import { recordRequests } from '@/db/schema'
import { tr } from '@/i18n/requests'
import { writeAudit } from '@/server/audit'
import { now } from '@/server/clock'
import { HttpError } from '@/server/http'
import { assertPatientAccess, loadPatient } from '@/server/patients'
import { buildLetter } from '@/server/requests/letter'
import { getSession, sessionRole } from '@/server/session'

export const metadata: Metadata = { title: 'Setu Records', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RequestLetterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { id } = await params
  const lang: Lang = (await searchParams).lang === 'hi' ? 'hi' : 'en'
  const s = await getSession()
  if (!s) redirect('/login')
  if (!UUID.test(id)) notFound()
  const data = await withOrg(s.orgId, async (tx) => {
    const [r] = await tx.select().from(recordRequests).where(eq(recordRequests.id, id))
    if (!r) return null
    try {
      await assertPatientAccess({ db: tx, session: s }, r.patientId)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return null
      throw e
    }
    const p = await loadPatient(tx, r.patientId)
    if (!p) return null
    await writeAudit(tx, {
      orgId: s.orgId, actorId: s.kind === 'staff' ? s.staffId : s.caregiverId ?? s.patientId, actorRole: sessionRole(s),
      action: 'request.letter_print', targetType: 'record_request', targetId: r.id, details: { patientId: r.patientId, lang },
    })
    return { r, p, today: istDate((await now(s.orgId)).toISOString()) }
  })
  if (!data) notFound()
  const { r, p, today } = data
  const l = buildLetter({
    lang, disclosure: p.disclosure, requestId: r.id, patient: { name: p.name, dob: p.dob }, institution: r.institution,
    institutionPatientId: typeof r.letterPayload?.institutionPatientId === 'string' ? r.letterPayload.institutionPatientId : null,
    documents: r.documents, dateRange: r.dateRange ?? null, today,
  })
  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`
  const qr = await QRCode.toDataURL(`${origin}/p/upload`, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  const blank = <span className="inline-block min-w-48 border-b border-ink">&nbsp;</span>

  return (
    <PrintSheet lang={lang} langHref={(x) => `/print/request/${id}?lang=${x}`}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
        <p className="font-display text-xl tracking-[-0.02em]">{l.brand}</p>
        <p className="font-mono text-[12px] text-muted">{l.date}</p>
      </header>
      <h1 className="mt-6 text-[1.6rem] leading-tight tracking-[-0.02em]">{l.title}</h1>

      <section className="mt-6 grid gap-0.5">
        <p>{tr(lang, 'letterTo')}</p>
        <p>{l.to.dept}</p>
        <p>{l.to.institution ?? <>{blank} <span className="text-[12px] text-muted">{l.to.blankLabel}</span></>}</p>
      </section>

      <p className="mt-5 font-medium">{l.subject}</p>
      <p className="mt-4">{l.salutation}</p>
      <p className="mt-2">{l.intro}</p>
      <ul className="mt-3 grid list-disc gap-1 pl-6">{l.documents.map((x) => <li key={x}>{x}</li>)}</ul>

      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-y border-rule py-3">
        {l.patient.map((x) => (
          <div key={x.label} className="contents"><dt className="text-muted">{x.label}</dt><dd>{x.value ?? blank}</dd></div>
        ))}
      </dl>
      <p className="mt-3">{l.period}</p>
      <p className="mt-4 text-[14px] text-muted">{l.reference}</p>

      <div className="mt-6 flex items-start gap-5 break-inside-avoid">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" width={120} height={120} className="shrink-0 border border-rule" />
        <div className="grid gap-1.5">
          <p>{l.returnText}</p>
          <p className="font-mono text-[12px] text-muted">{l.qrCaption}</p>
        </div>
      </div>

      <p className="mt-6">{l.thanks}</p>
      <section className="mt-10 grid gap-6 break-inside-avoid sm:grid-cols-2 print:grid-cols-2">
        {l.sign.map((x) => (
          <div key={x} className="grid gap-1"><span className="h-8 border-b border-ink" /><span className="text-[13px] text-muted">{x}</span></div>
        ))}
      </section>
      <footer className="mt-10 border-t border-rule pt-3 font-mono text-[11px] text-faint">{l.footer}</footer>
    </PrintSheet>
  )
}
