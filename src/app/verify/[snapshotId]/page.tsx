import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleCheck, CircleX } from 'lucide-react'
import { BrassSeal, Frame, KeyValue, LanguageToggle, Spotlight, Wordmark } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { verifyCopy as T } from '@/i18n/ledger'
import { verifySnapshotPublic } from '@/server/ledger/seal'
import { browserLang } from '@/server/portal/context'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k] ?? m))

// Public and unidentified: the brand stays neutral (the viewer's disclosure status is unknown, FR-CON-07).
export const metadata = { title: 'Seal verification · Setu Records', robots: { index: false } }

function Check({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok
    ? <span className="inline-flex items-center gap-1.5 text-sage-ink"><CircleCheck aria-hidden className="size-4" />{yes}</span>
    : <span className="inline-flex items-center gap-1.5 font-medium text-madder-ink"><CircleX aria-hidden className="size-4" />{no}</span>
}

/** Public verdict for one sealed snapshot: hash recomputed from the stored bytes, Ed25519 signature checked. No patient data. */
export default async function VerifySnapshotPage({ params, searchParams }: { params: Promise<{ snapshotId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { snapshotId } = await params
  const asked = (await searchParams).lang
  const lang = asked === 'hi' || asked === 'en' ? asked : await browserLang()
  if (!UUID.test(snapshotId)) notFound()
  const v = await verifySnapshotPublic(snapshotId)
  if (!v) notFound()
  const intact = v.hashMatches && v.signatureValid
  const time = new Date(Date.parse(v.sealedAt) + 330 * 60_000).toISOString().slice(11, 16)
  const t = (k: Exclude<keyof typeof T, never>) => T[k][lang]

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Spotlight />
      <main lang={lang} className="relative mx-auto grid max-w-2xl gap-8 px-4 py-10 sm:py-16">
        <div className="flex items-center justify-between gap-4">
          <Wordmark brand="Setu Records" />
          <LanguageToggle value={lang} />
        </div>
        <div className="grid justify-items-center gap-4 text-center">
          {intact ? (
            <BrassSeal animate code={v.sha256Stored} label={`S${v.seq} intact`} ringText={t('ring')} size={168} />
          ) : (
            <span aria-hidden className="grid size-[168px] place-items-center rounded-full border-2 border-dashed border-madder bg-madder-tint font-mono text-xs tracking-[0.16em] text-madder-ink uppercase">{t('brokenBadge')}</span>
          )}
          <p className="ds-kicker">{fill(t('sealedLine'), { seq: v.seq, date: formatDateIN(v.sealedAt, lang), time })}</p>
          <h1 className="text-3xl leading-tight tracking-[-0.025em] sm:text-4xl">{intact ? t('intactTitle') : t('brokenTitle')}</h1>
          <p className="max-w-lg text-muted">{intact ? t('intactBody') : t('brokenBody')}</p>
        </div>

        <Frame className="px-5 py-5 sm:px-6">
          <KeyValue items={[
            { label: t('hash'), value: <Check ok={v.hashMatches} yes={t('hashOk')} no={t('hashBad')} /> },
            { label: t('signature'), value: <Check ok={v.signatureValid} yes={t('sigOk')} no={t('sigBad')} /> },
            { label: t('sealed'), value: <span className="font-mono text-[13px] break-all">{v.sha256Stored}</span> },
            { label: t('now'), value: <span className="font-mono text-[13px] break-all">{v.sha256Recomputed}</span> },
            { label: t('key'), value: <span className="font-mono text-[13px]">{v.keyId ?? '—'} · <Link href="/api/keys" className="text-setu-ink underline decoration-brass underline-offset-4">{t('publicKeys')}</Link></span> },
            ...(v.counts ? [{ label: t('contents'), value: <span className="font-mono text-[13px]">{fill(t('counts'), v.counts)}</span> }] : []),
          ]} />
        </Frame>
        <p className="text-center text-sm text-faint">{t('footer')}</p>
      </main>
    </div>
  )
}
