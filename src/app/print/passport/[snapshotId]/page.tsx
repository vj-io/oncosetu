// Printable Continuity Passport (FR-PAS-05): one sealed visit's document index on A4, with the seal hash, the signing key,
// the seal time and a QR to the public check at /verify/[id]. The patient carries this paper, so it is built from the share
// payload: exactly what a share link shows (no staff-only lines, no quotes, FR-CON-07 brand and wording).
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { PrintSheet } from '@/components/requests/PrintSheet'
import { formatDateIN, inLang, istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { withOrg } from '@/db'
import { snapshots } from '@/db/schema'
import { ts, type ShareKey } from '@/i18n/shares'
import { writeAudit } from '@/server/audit'
import { HttpError } from '@/server/http'
import { assertConsent, assertPatientAccess } from '@/server/patients'
import { formatDateTimeIN } from '@/server/portal/summary'
import type { Verification } from '@/server/shares/payload'
import { sharePayloadFor } from '@/server/shares/shares'
import { requireStaff, sessionRole } from '@/server/session'

export const metadata: Metadata = { title: 'Setu Records', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHECKED: Record<Verification, ShareKey> = {
  records: 'verifiedRecords', clinician: 'verifiedClinician', verified: 'verified', unverified: 'notVerified', disputed: 'disputed',
}
const ABSENT: Record<string, ShareKey> = { requested: 'absentRequested', received: 'absentReceived' }

export default async function PassportPage({ params, searchParams }: { params: Promise<{ snapshotId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { snapshotId } = await params
  const lang: Lang = (await searchParams).lang === 'hi' ? 'hi' : 'en'
  const s = await requireStaff(['desk', 'records', 'clinician']) // the roles that prepare share links
  if (!UUID.test(snapshotId)) notFound()
  const data = await withOrg(s.orgId, async (tx) => {
    const [snap] = await tx.select({ patientId: snapshots.patientId, keyId: snapshots.keyId }).from(snapshots).where(eq(snapshots.id, snapshotId))
    if (!snap) return null
    try {
      await assertPatientAccess({ db: tx, session: s }, snap.patientId)
      await assertConsent(tx, snap.patientId, 'share') // the paper leaves the hospital like a share link
    } catch (e) {
      if (e instanceof HttpError && [403, 404, 410].includes(e.status)) return null
      throw e
    }
    const p = await sharePayloadFor(tx, snap.patientId, 'index', s, snapshotId)
    await writeAudit(tx, {
      orgId: s.orgId, actorId: s.staffId, actorRole: sessionRole(s), action: 'snapshot.passport_print', targetType: 'patient', targetId: snap.patientId,
      details: { snapshotId, lang },
    })
    return { p, keyId: snap.keyId }
  })
  if (!data) notFound()
  const { p, keyId } = data
  const t = (k: ShareKey, v?: Record<string, string | number>) => ts(lang, k, v)
  const h = await headers()
  const verifyUrl = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}/verify/${snapshotId}`
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  // The sealed file holds staff-only lines: offered to records officers and clinicians on screen, never printed.
  const download = s.role === 'desk' ? null : (
    <a href={`/api/snapshots/${snapshotId}`} download className="text-sm text-setu-ink underline decoration-brass underline-offset-4">Download the sealed file for an offline check</a>
  )

  return (
    <PrintSheet lang={lang} langHref={(x) => `/print/passport/${snapshotId}?lang=${x}`} actions={download}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
        <p className="font-display text-xl tracking-[-0.02em]">{p.brand}</p>
        <p className="font-mono text-[12px] text-muted">{t('asOf', { date: formatDateIN(istDate(p.asOf), lang) })}</p>
      </header>
      <h1 className="mt-6 text-[1.6rem] leading-tight tracking-[-0.02em]">{inLang(p.heading, lang)}</h1>
      <p className="mt-2">{inLang(p.notice, lang)}</p>

      <section aria-labelledby="items-h" className="mt-6">
        <h2 id="items-h" className="text-lg font-medium">{t('itemsTitle')}</h2>
        {p.items.length ? (
          <ol className="mt-2 grid gap-1.5">
            {p.items.map((it, i) => {
              const source = it.source.label ? `${t('source')}: ${inLang(it.source.label, lang)}${it.source.page ? `, ${t('page', { n: it.source.page })}` : ''}` : null
              return (
                <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-x-4 border-b border-rule pb-1.5 break-inside-avoid">
                  <span className="font-mono text-[12px] text-muted">{formatDateIN(it.date, lang, it.precision)}</span>
                  <span>
                    <span className="font-medium">{inLang(it.label, lang)}</span>
                    <span className="text-[13px] text-muted"> · {[it.institution, source, t(CHECKED[it.verification])].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        ) : <p className="mt-2 text-muted">{t('itemsEmpty')}</p>}
      </section>

      <section aria-labelledby="absent-h" className="mt-6">
        <h2 id="absent-h" className="text-lg font-medium">{t('absentTitle')}</h2>
        <p className="text-[13px] text-muted">{t('absentIntro')}</p>
        {p.absent.length ? (
          <ul className="mt-2 grid list-disc gap-1 pl-6">
            {p.absent.map((a, i) => <li key={i}>{inLang(a.text, lang)} <span className="text-[13px] text-muted">({t(ABSENT[a.state] ?? 'absentExpected')})</span></li>)}
          </ul>
        ) : <p className="mt-2 text-muted">{t('absentNone')}</p>}
      </section>

      <section aria-labelledby="docs-h" className="mt-6">
        <h2 id="docs-h" className="text-lg font-medium">{t('docsTitle')}</h2>
        {p.documents.length ? (
          <ul className="mt-2 grid list-disc gap-1 pl-6">
            {p.documents.map((d) => (
              <li key={d.id}>
                {inLang(d.label, lang)}
                <span className="text-[13px] text-muted"> · {[d.date ? formatDateIN(d.date, lang) : null, d.institution, t('received', { date: formatDateIN(istDate(d.receivedAt), lang) })].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-muted">{t('docsEmpty')}</p>}
      </section>

      <section aria-labelledby="seal-h" className="mt-8 flex items-start gap-5 border-t-2 border-ink pt-4 break-inside-avoid">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={t('verifySeal')} width={120} height={120} className="shrink-0 border border-rule" />
        <div className="grid min-w-0 gap-1">
          <h2 id="seal-h" className={`ds-kicker ${lang === 'hi' ? 'tracking-normal normal-case' : ''}`}>{t('sealTitle')}</h2>
          <p>{t('sealedOn', { when: formatDateTimeIN(p.asOf, lang) })}</p>
          <p className="font-mono text-[12px] break-all">{t('sealText', { id: snapshotId, hash: p.seal.sha256 })}</p>
          <p className="font-mono text-[12px]">{t('sealKey', { key: keyId ?? '—' })}</p>
          <p className="text-[13px] text-muted">{t('scanToVerify')}</p>
          <p className="font-mono text-[12px] break-all">{verifyUrl}</p>
        </div>
      </section>
    </PrintSheet>
  )
}
