'use client'
// Share the document index (J5, FR-PAS-02): fetch the payload of the latest sealed snapshot, encrypt it HERE with a
// fresh AES-256-GCM key, upload only ciphertext + iv. The key goes into the link's #fragment and never to the server.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { Check, Copy, KeyRound, Link2, ShieldAlert } from 'lucide-react'
import { Button, EmptyState, Field, Frame, Input, Select, Switch } from '@/components/ui'
import { formatDateIN, istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { ts, type ShareKey } from '@/i18n/shares'
import type { SharePayload, ShareScope } from '@/server/shares/payload'
import clsx from 'clsx'
import { api, ApiError } from '../requests/api'
import { sideStyle } from '../requests/side'
import { encryptJson } from './crypto'

type Payload = SharePayload & { snapshotId: string }
type Created = { url: string; qr: string; expiresAt: string; passcode: string | null }

const DAYS = [1, 3, 7, 14, 30]
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')

/** `allowQuotes` false for the desk: the server refuses quoted shares from it, so the option is not offered. */
export function CreateShareForm({ patientId, actor, lang = 'en', allowQuotes = true }: { patientId: string; actor: 'staff' | 'patient'; lang?: Lang; allowQuotes?: boolean }) {
  const router = useRouter()
  const t = (k: ShareKey, v?: Record<string, string | number>) => ts(lang, k, v)
  const ui = sideStyle(actor, lang)
  const payloadUrl = (scope: ShareScope) =>
    actor === 'staff' ? `/api/patients/${patientId}/share-payload?scope=${scope}` : `/api/p/share-payload?scope=${scope}`

  const [pre, setPre] = useState<Payload | 'no_snapshot' | 'no_consent' | 'error' | null>(null)
  const [scope, setScope] = useState<ShareScope>('index')
  const [days, setDays] = useState(7)
  const [usePasscode, setUsePasscode] = useState(true)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<Payload>(payloadUrl('index')).then((p) => { setPre(p); setPasscode(randomCode()) }).catch((e) => setPre(
      e instanceof ApiError && e.code === 'no_snapshot' ? 'no_snapshot' : e instanceof ApiError && e.code === 'consent_required' ? 'no_consent' : 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, actor])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (usePasscode && passcode.trim().length < 6) return setError(t('passcodeTooShort'))
    setError(null)
    setBusy(true)
    try {
      const payload = scope === 'index' && pre && typeof pre === 'object' ? pre : await api<Payload>(payloadUrl(scope))
      const { key, ciphertext, iv } = await encryptJson(payload)
      const code = usePasscode ? passcode.trim() : null
      const r = await api<{ id: string; expiresAt: string }>('/api/shares', {
        ...(actor === 'staff' ? { patientId } : {}), snapshotId: payload.snapshotId, ciphertext, iv, scope, expiresInDays: days, passcode: code,
      })
      const url = `${window.location.origin}/s/${r.id}#${key}`
      setCreated({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }), expiresAt: r.expiresAt, passcode: code })
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'consent_required' ? t('noConsent') : err instanceof ApiError && err.code === 'no_snapshot' ? t('noSnapshot') : t('genericError'))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    try { await navigator.clipboard.writeText(created.url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked: the link is selectable */ }
  }

  if (pre === null) return <Frame className="px-5 py-6 text-muted">…</Frame>
  if (pre === 'no_snapshot') return <EmptyState icon={<Link2 />} title={t('formTitle')} description={t('noSnapshot')} />
  if (pre === 'no_consent') return <EmptyState icon={<ShieldAlert />} title={t('formTitle')} description={t('noConsent')} />
  if (pre === 'error') return <p role="alert" className="text-madder-ink">{t('genericError')}</p>

  if (created) {
    return (
      <Frame className="grid gap-5 px-5 py-6 sm:px-6" animate>
        <div className="flex items-center gap-2"><Check aria-hidden className="size-5 text-sage-ink" /><h3 className="text-xl">{t('linkReady')}</h3></div>
        <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={created.qr} alt={t('qrAlt')} width={200} height={200} className="border border-rule bg-white p-2" />
          <div className="grid min-w-0 gap-3">
            <Field label={ui.plain(t('linkLabel'))}>
              <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[13px]" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size={ui.size} className={ui.btn} variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? t('copied') : t('copy')}</Button>
              <Button size={ui.size} className={ui.btn} variant="ghost" onClick={() => { setCreated(null); setPasscode(randomCode()) }}>{t('another')}</Button>
            </div>
            <p className="text-[15px]">{t('worksUntil', { date: formatDateIN(istDate(created.expiresAt), lang) })}</p>
            {created.passcode && <p className={clsx('flex items-center gap-2 text-[15px]', lang === 'hi' ? 'font-deva' : 'font-mono')}><KeyRound aria-hidden className="size-4" />{t('passcodeReminder', { code: created.passcode })}</p>}
            {created.passcode && <p className="text-sm text-muted">{t('passcodeHint')}</p>}
            <p className="text-sm text-muted">{t('keyNote')}</p>
          </div>
        </div>
      </Frame>
    )
  }

  const quotesAllowed = allowQuotes && pre.brand === 'OncoSetu' // brand is "OncoSetu" only when disclosure is cleared
  return (
    <Frame className="px-5 py-6 sm:px-6">
      <form onSubmit={create} className="grid gap-5" noValidate>
        <div className="grid gap-1">
          <h3 className="text-xl">{t('formTitle')}</h3>
          <p className="text-[15px] text-muted">{t('formIntro')}</p>
          <p className={ui.kicker ? clsx('text-faint', ui.kicker) : 'font-mono text-[12px] text-faint'}>{t('asOf', { date: formatDateIN(istDate(pre.asOf), lang) })}</p>
        </div>
        {quotesAllowed && (
          <Field label={ui.plain(t('scopeLabel'))}>
            <Select value={scope} onChange={(e) => setScope(e.target.value as ShareScope)}>
              <option value="index">{t('scopeIndex')}</option>
              <option value="index_with_quotes">{t('scopeQuotes')}</option>
            </Select>
          </Field>
        )}
        <Field label={ui.plain(t('expiryLabel'))}>
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.map((n) => <option key={n} value={n}>{n === 1 ? t('oneDay') : t('days', { n })}</option>)}
          </Select>
        </Field>
        <Switch label={t('passcodeOn')} checked={usePasscode} onChange={(e) => setUsePasscode(e.target.checked)} />
        {usePasscode ? (
          <Field label={ui.plain(t('passcodeLabel'))} hint={t('passcodeHint')}>
            <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} minLength={6} maxLength={64} autoComplete="off" className="font-mono" />
          </Field>
        ) : (
          <p role="note" className="flex items-start gap-2 border-l-[3px] border-l-amber bg-amber-tint px-3 py-2 text-[15px] text-amber-ink">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{t('passcodeOffWarning')}
          </p>
        )}
        <p className="text-sm text-muted">{t('keyNote')}</p>
        {error && <p role="alert" className="text-sm text-madder-ink">{error}</p>}
        <div><Button type="submit" size="md" className={ui.btn} loading={busy} icon={<Link2 />}>{busy ? t('creating') : t('create')}</Button></div>
      </form>
    </Frame>
  )
}
