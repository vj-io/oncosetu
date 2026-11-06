'use client'
// Public share viewer (J5, FR-PAS-02/03): no account. The key is read from location.hash (never sent anywhere);
// the server returns only ciphertext after expiry/revocation/consent/passcode checks; decryption happens here.
import { useEffect, useState } from 'react'
import { ArrowUpRight, FileText, Lock, Printer, ShieldAlert, ShieldCheck } from 'lucide-react'
import { BrassSeal, Button, Chip, EmptyFrame, Field, Frame, Input, KeyValue, LanguageToggle, SectionHeader, Spotlight, Wordmark, type Tone } from '@/components/ui'
import { formatDateIN, htmlLang, inLang, istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { ts, type ShareKey } from '@/i18n/shares'
import type { Verification } from '@/server/shares/payload'
import type { SignedSharePayload } from '@/server/shares/shares'
import { decryptJson, verifySharePayload } from './crypto'

// `verified`: the payload carries a valid OncoSetu signature. Anything else is creator-controlled and is shown as such.
type Phase =
  | { k: 'loading' } | { k: 'passcode'; left?: number } | { k: 'open'; p: SignedSharePayload; verified: boolean }
  | { k: 'error'; msg: ShareKey }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VERIFY: Record<Verification, { key: ShareKey; tone: Tone }> = {
  records: { key: 'verifiedRecords', tone: 'verified' },
  clinician: { key: 'verifiedClinician', tone: 'verified' },
  verified: { key: 'verified', tone: 'verified' },
  unverified: { key: 'notVerified', tone: 'unverified' },
  disputed: { key: 'disputed', tone: 'conflict' },
}

export function ShareViewer({ id }: { id: string }) {
  const [lang, setLang] = useState<Lang>('en')
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const t = (k: ShareKey, v?: Record<string, string | number>) => ts(lang, k, v)
  /** Devanagari: no uppercase or letter-spacing tracking (it breaks conjuncts). */
  const hi = (text: string) => (lang === 'hi' ? <span className="font-deva tracking-normal normal-case">{text}</span> : text)

  /** Asks the server for the ciphertext and decrypts it here with the key from the #fragment. */
  async function resolve(code?: string): Promise<Phase> {
    const key = window.location.hash.slice(1)
    if (!key) return { k: 'error', msg: 'missingKey' }
    try {
      const res = await fetch(`/api/shares/${encodeURIComponent(id)}/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(code ? { passcode: code } : {}), cache: 'no-store',
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        try {
          const p = await decryptJson<SignedSharePayload>(key, body.ciphertext, body.iv)
          return { k: 'open', p, verified: await verifySharePayload(p) }
        } catch {
          return { k: 'error', msg: 'decryptFailed' }
        }
      }
      if (res.status === 401) return { k: 'passcode', left: body?.error?.code === 'wrong_passcode' ? body.attemptsLeft : undefined }
      return { k: 'error', msg: res.status === 410 ? 'gone' : res.status === 423 ? 'locked' : res.status === 404 ? 'notFound' : 'genericError' }
    } catch {
      return { k: 'error', msg: 'offline' }
    }
  }

  async function submit(code: string) {
    setBusy(true)
    setPhase(await resolve(code))
    setBusy(false)
  }

  useEffect(() => {
    let alive = true
    resolve().then((ph) => {
      if (!alive) return
      // Start in Hindi when the viewer's browser prefers it (the toggle still switches); read after mount, not during SSR.
      if (navigator.languages?.find((l) => /^(hi|en)\b/i.test(l))?.toLowerCase().startsWith('hi')) setLang('hi')
      setPhase(ph)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const p = phase.k === 'open' ? phase.p : null
  const signed = phase.k === 'open' && phase.verified
  // Built here, never taken from the payload: a forged `verifyPath` could point anywhere (javascript:, another site).
  const verifyHref = p && typeof p.seal?.snapshotId === 'string' && UUID.test(p.seal.snapshotId) ? `/verify/${p.seal.snapshotId}` : null
  return (
    <div lang={htmlLang(lang)} className={`relative flex min-h-dvh flex-col ${lang === 'hi' ? 'font-deva' : ''}`}>
      <header className="relative z-10 border-b border-rule bg-gallery print:border-b-2">
        <div className="mx-auto flex min-h-16 max-w-reading flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Wordmark brand={signed ? p!.brand : 'Setu Records'} />
          <div className="ml-auto flex items-center gap-2 print:hidden">
            {p && <Button size="sm" variant="ghost" icon={<Printer />} onClick={() => window.print()}>{t('printIndex')}</Button>}
            <LanguageToggle value={lang} onChange={setLang} />
          </div>
        </div>
      </header>
      <div className="relative flex-1">
        <Spotlight className="opacity-80 print:hidden" />
        <main id="main" className="relative mx-auto w-full max-w-reading px-4 py-8 sm:px-6 sm:py-12">
          {phase.k === 'loading' && <p className="text-muted" aria-live="polite">…</p>}

          {phase.k === 'error' && (
            <Frame className="grid gap-2 px-5 py-6"><p className="ds-kicker">{t('viewerKicker')}</p><p role="alert" className="text-lg">{t(phase.msg)}</p></Frame>
          )}

          {phase.k === 'passcode' && (
            <Frame className="px-5 py-6 sm:px-6">
              <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (passcode.trim()) void submit(passcode.trim()) }}>
                <div className="flex items-center gap-2"><Lock aria-hidden className="size-5 text-muted" /><h1 className="text-2xl">{t('passcodeTitle')}</h1></div>
                <p className="text-muted">{t('passcodeIntro')}</p>
                <Field label={t('passcodeLabel')} error={phase.left != null ? t('wrongPasscode', { n: phase.left }) : undefined}>
                  <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" autoFocus maxLength={64} className="font-mono" />
                </Field>
                <div><Button type="submit" loading={busy}>{busy ? t('opening') : t('open')}</Button></div>
              </form>
            </Frame>
          )}

          {p && (
            <article className="grid gap-12">
              <div className="grid gap-3">
                <p className="ds-kicker">{t('viewerKicker')}</p>
                <h1 className="text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{inLang(p.heading, lang)}</h1>
                <p className="text-[17px]">{inLang(p.notice, lang)}</p>
                <p className="font-mono text-[13px] text-muted">{t('asOf', { date: formatDateIN(istDate(p.asOf), lang) })}</p>
                {signed ? (
                  <p role="status" className="flex items-start gap-2 border-l-[3px] border-l-sage bg-sage-tint px-3 py-2 text-[15px] text-sage-ink">
                    <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />{t('sigVerified', { brand: p.brand, date: formatDateIN(istDate(p.issuedAt), lang) })}
                  </p>
                ) : (
                  <p role="alert" className="flex items-start gap-2 border-l-[3px] border-l-madder bg-madder-tint px-3 py-2 text-[15px] text-madder-ink">
                    <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{t('sigNotVerified')}
                  </p>
                )}
              </div>

              <section aria-labelledby="items-h" className="grid gap-5">
                <SectionHeader title={<span id="items-h">{t('itemsTitle')}</span>} />
                {p.items.length ? (
                  <ol className="grid gap-4">
                    {p.items.map((it, i) => {
                      const v = signed ? VERIFY[it.verification] : undefined // chips only when the server vouches for them
                      const source = it.source.label ? `${inLang(it.source.label, lang)}${it.source.page ? `, ${t('page', { n: it.source.page })}` : ''}` : '—'
                      return (
                        <li key={i}>
                          <Frame animate delay={Math.min(i * 40, 400)} className="grid gap-3 px-5 py-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h2 className="text-lg leading-snug">{inLang(it.label, lang)}</h2>
                              <span className="font-mono text-[13px] text-muted">{formatDateIN(it.date, lang, it.precision)}</span>
                            </div>
                            <KeyValue items={[
                              { label: t('source'), value: source },
                              ...(it.institution ? [{ label: t('placeLabel'), value: it.institution }] : []),
                              ...(v ? [{ label: t('verificationLabel'), value: <Chip tone={v.tone}>{t(v.key)}</Chip> }] : []),
                            ]} />
                            {it.quote && (
                              <figure className="grid gap-1 border-l-[3px] border-l-brass pl-3">
                                <figcaption className="ds-kicker">{t('quote')}</figcaption>
                                <blockquote className="font-display text-[17px] leading-snug">“{it.quote}”</blockquote>
                              </figure>
                            )}
                          </Frame>
                        </li>
                      )
                    })}
                  </ol>
                ) : <p className="text-muted">{t('itemsEmpty')}</p>}
              </section>

              <section aria-labelledby="absent-h" className="grid gap-5">
                <SectionHeader title={<span id="absent-h">{t('absentTitle')}</span>} description={t('absentIntro')} />
                {p.absent.length ? (
                  <div className="grid gap-6">
                    {p.absent.map((a, i) => {
                      const status = a.state === 'received' ? 'received' : a.state === 'requested' ? 'requested' : 'expected'
                      const k = status === 'received' ? 'absentReceived' : status === 'requested' ? 'absentRequested' : 'absentExpected'
                      return (
                        <EmptyFrame key={i} animate delay={Math.min(i * 60, 400)} title={inLang(a.text, lang)} status={status}
                          kicker={hi(t(status === 'received' ? 'absentKickerReceived' : 'absentKicker'))} statusLabel={hi(t(k))} />
                      )
                    })}
                  </div>
                ) : <p className="text-muted">{t('absentNone')}</p>}
              </section>

              <section aria-labelledby="docs-h" className="grid gap-5">
                <SectionHeader title={<span id="docs-h">{t('docsTitle')}</span>} />
                {p.documents.length ? (
                  <ul className="grid gap-2">
                    {p.documents.map((d) => (
                      <li key={d.id} className="flex items-start gap-3 border-b border-rule pb-2 last:border-b-0">
                        <FileText aria-hidden className="mt-1 size-4 shrink-0 text-faint" />
                        <span className="grid gap-0.5">
                          <span>{inLang(d.label, lang)}</span>
                          <span className="text-[14px] text-muted">{[d.date ? formatDateIN(d.date, lang) : null, d.institution, t('received', { date: formatDateIN(istDate(d.receivedAt), lang) })].filter(Boolean).join(' · ')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-muted">{t('docsEmpty')}</p>}
              </section>

              <section aria-labelledby="seal-h" className="flex flex-wrap items-center gap-5 border-t border-rule pt-8">
                <BrassSeal code={p.seal.sha256} size={96} />
                <div className="grid min-w-0 gap-1">
                  <h2 id="seal-h" className="ds-kicker">{t('sealTitle')}</h2>
                  <p className="font-mono text-[12px] break-all text-muted">{t('sealText', { id: p.seal.snapshotId.slice(0, 8), hash: p.seal.sha256.slice(0, 16) + '…' })}</p>
                  {verifyHref && <a href={verifyHref} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4 print:hidden">{t('verifySeal')}<ArrowUpRight aria-hidden className="size-3.5" /></a>}
                </div>
              </section>
            </article>
          )}
        </main>
      </div>
      <footer className="border-t border-rule">
        <p className="mx-auto max-w-reading px-4 py-6 text-[15px] text-muted sm:px-6">{p ? `${inLang(p.heading, lang)}. ${t('viewerFooter')}` : t('viewerFooter')}</p>
      </footer>
    </div>
  )
}
