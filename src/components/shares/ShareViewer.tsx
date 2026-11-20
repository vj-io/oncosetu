'use client'
// Public share viewer (J5, FR-PAS-02/03): no account. The key is read from location.hash (never sent anywhere);
// the server returns only ciphertext after expiry/revocation/consent/passcode checks; decryption happens here.
import { useEffect, useState } from 'react'
import { ArrowUpRight, Lock, Printer, ShieldAlert, ShieldCheck } from 'lucide-react'
import { BrassSeal, Button, Chip, EmptyFrame, Field, Frame, Input, LanguageToggle, SectionHeader, Spotlight, Wordmark, type Tone } from '@/components/ui'
import { formatDateIN, htmlLang, inLang, istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { tn, ts, type ShareKey } from '@/i18n/shares'
import type { Verification } from '@/server/shares/payload'
import type { SignedSharePayload } from '@/server/shares/shares'
import { decryptJson, verifySharePayload } from './crypto'

// `verified`: the payload carries a valid OncoSetu signature. Anything else is creator-controlled and is shown as such.
type Phase =
  | { k: 'loading' } | { k: 'passcode'; left?: number } | { k: 'open'; p: SignedSharePayload; verified: boolean }
  | { k: 'error'; msg: ShareKey }

// Words only this viewer uses (the shared i18n file belongs to another package). en / hi / hinglish.
const L = {
  papers: { en: 'Papers shared', hi: 'साझा किए गए काग़ज़', hinglish: 'Share kiye gaye papers' },
  details: { en: 'What it contains', hi: 'इसमें क्या है', hinglish: 'Isme kya hai' },
  noDate: { en: 'Date not given', hi: 'तारीख़ नहीं दी गई', hinglish: 'Date nahi di gayi' },
  otherTitle: { en: 'Other recorded items', hi: 'अन्य दर्ज प्रविष्टियाँ', hinglish: 'Anya darj entries' },
  scansHead: { en: 'Scans', hi: 'स्कैन', hinglish: 'Scans' },
  scansIntro: { en: 'Scan images are stored at the clinic and are not included in this link. Ask the clinic for them.', hi: 'स्कैन की तस्वीरें क्लिनिक में रखी हैं और इस लिंक में शामिल नहीं हैं। इनके लिए क्लिनिक से पूछें।', hinglish: 'Scan ki images clinic mein rakhi hain aur is link mein shaamil nahi hain. Inke liye clinic se poochhein.' },
  scanNote: { en: 'Stored at the clinic, not included', hi: 'क्लिनिक में रखा है, शामिल नहीं', hinglish: 'Clinic mein rakha hai, shaamil nahi' },
  absentHead: { en: 'Papers not in this file', hi: 'इस फ़ाइल में न मिले काग़ज़', hinglish: 'Is file mein na mile papers' },
} as const

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
  const [showCode, setShowCode] = useState(false)
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
  // One card per paper: kind and date up front, then the hospital and the first line that tells it apart from its twins.
  type Item = SignedSharePayload['items'][number]
  type Doc = SignedSharePayload['documents'][number]
  const byDoc = new Map<string, Item[]>()
  const orphans: Item[] = []
  if (p) {
    const known = new Set(p.documents.map((d) => d.id))
    for (const it of p.items) {
      const id = it.source.documentId
      if (id && known.has(id)) byDoc.set(id, [...(byDoc.get(id) ?? []), it])
      else orphans.push(it)
    }
  }
  const docDate = (d: Doc) => d.date ?? ''
  const groups = (() => {
    if (!p) return []
    const m = new Map<string, Doc[]>()
    for (const d of p.documents) { const k = inLang(d.label, lang); m.set(k, [...(m.get(k) ?? []), d]) }
    const newest = (ds: Doc[]) => ds.map(docDate).sort().at(-1) ?? ''
    return [...m.entries()]
      .map(([label, docs]) => ({ label, docs: [...docs].sort((a, b) => (docDate(b) || b.receivedAt).localeCompare(docDate(a) || a.receivedAt)) }))
      .sort((a, b) => newest(b.docs).localeCompare(newest(a.docs)))
  })()
  const renderItems = (items: Item[]) => {
    return (
      <ul className="grid gap-3">
        {items.map((it, i) => {
          const v = signed ? VERIFY[it.verification] : undefined // chips only when the server vouches for them
          const where = it.source.label ? `${inLang(it.source.label, lang)}${it.source.page ? `, ${t('page', { n: it.source.page })}` : ''}` : null
          return (
            <li key={i} data-testid="share-item" className="grid gap-1.5 border-l-[3px] border-l-rule pl-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[16px]">{inLang(it.label, lang)}</span>
                <span className="font-mono text-[13px] text-muted">{formatDateIN(it.date, lang, it.precision)}</span>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
                {[where, it.institution].filter(Boolean).join(' · ')}
                {v && <Chip tone={v.tone}>{t(v.key)}</Chip>}
              </p>
              {it.quote && <blockquote className="border-l-[3px] border-l-brass pl-3 font-display text-[16px] leading-snug">“{it.quote}”</blockquote>}
            </li>
          )
        })}
      </ul>
    )
  }
  const renderPaper = (d: Doc) => {
    const its = byDoc.get(d.id) ?? []
    // First as-written line: a quote when the patient shared quotes, else the first recorded item that is not just the paper's own kind.
    const first = its.find((x) => x.quote) ?? its.find((x) => inLang(x.label, lang) !== inLang(d.label, lang)) ?? its[0]
    // Quotes only: without them the first item's own kind and date would read as the paper's (PUB-08); the count below says what is inside.
    const line = first?.quote ? `“${first.quote}”` : null
    return (
      <Frame className="grid gap-2 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-[14px]">{d.date ? formatDateIN(d.date, lang) : L.noDate[lang]}</span>
          <span className="font-mono text-[12px] text-muted">{t('received', { date: formatDateIN(istDate(d.receivedAt), lang) })}</span>
        </div>
        {d.institution && <p className="text-[16px]">{d.institution}</p>}
        {line && <p className="text-[15px] leading-snug text-muted">{line}</p>}
        {its.length > 0 && (
          <details className="border-t border-rule pt-2">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[15px] text-setu-ink">
              <span>{L.details[lang]}</span><span className="font-mono text-[12px] text-muted">{tn(lang, 'itemsN', 'itemsOne', its.length)}</span>
            </summary>
            <div className="pt-2">{renderItems(its)}</div>
          </details>
        )}
      </Frame>
    )
  }
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
                  <Input type={showCode ? 'text' : 'password'} value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" autoFocus maxLength={64} className="font-mono" />
                </Field>
                <div><Button type="button" size="sm" variant="ghost" aria-pressed={showCode} onClick={() => setShowCode((v) => !v)}>{showCode ? t('hidePasscode') : t('showPasscode')}</Button></div>
                <div><Button type="submit" loading={busy}>{busy ? t('opening') : t('open')}</Button></div>
              </form>
            </Frame>
          )}

          {p && (
            <article className="grid gap-12">
              <div className="grid gap-3">
                <p className="ds-kicker">{t('viewerKicker')}</p>
                <h1 className="text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{inLang(p.heading, lang)}</h1>
                <p className="text-[17px]">{t(p.createdBy === 'staff' ? 'byClinic' : p.createdBy === 'patient' ? 'byPatient' : p.createdBy === 'caregiver' ? 'byFamily' : 'byUnknown')}</p>
                <p className="text-[17px]">{inLang(p.notice, lang)}</p>{/* FR-PAS-03 / ADR-002: only records provided to the clinic */}
                <p className="font-mono text-[13px] text-muted">{t('asOf', { date: formatDateIN(istDate(p.asOf), lang) })}</p>
                {signed ? (
                  <p role="status" className="flex items-start gap-2 border-l-[3px] border-l-sage bg-sage-tint px-3 py-2 text-[15px] text-sage-ink">
                    <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />{t('sigVerified', { brand: p.brand, date: formatDateIN(istDate(p.issuedAt), lang), sealDate: formatDateIN(istDate(p.asOf), lang) })}
                  </p>
                ) : (
                  <p role="alert" className="flex items-start gap-2 border-l-[3px] border-l-madder bg-madder-tint px-3 py-2 text-[15px] text-madder-ink">
                    <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{t('sigNotVerified')}
                  </p>
                )}
              </div>

              <section aria-labelledby="papers-h" className="grid gap-6">
                <SectionHeader title={<span id="papers-h">{L.papers[lang]}</span>} description={tn(lang, 'papersShared', 'papersSharedOne', p.documents.length)} />
                {groups.length ? groups.map((g) => (
                  <div key={g.label} className="grid gap-3">
                    <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule pb-1 text-lg">
                      <span>{g.label}</span>
                      <span className="font-mono text-[13px] text-muted">{tn(lang, 'papersN', 'papersOne', g.docs.length)}</span>
                    </h3>
                    <ul className="grid gap-3">
                      {g.docs.map((d) => <li key={d.id}>{renderPaper(d)}</li>)}
                    </ul>
                  </div>
                )) : <p className="text-muted">{t('docsEmpty')}</p>}
                {orphans.length > 0 && (
                  <div className="grid gap-3">
                    <h3 className="border-b border-rule pb-1 text-lg">{L.otherTitle[lang]}</h3>
                    {renderItems(orphans)}
                  </div>
                )}
              </section>

              {p.scans && p.scans.length > 0 && (
                <section aria-labelledby="scans-h" className="grid gap-4">
                  <SectionHeader title={<span id="scans-h">{L.scansHead[lang]}</span>} description={L.scansIntro[lang]} />
                  <ul className="grid gap-2">
                    {p.scans.map((sc, i) => (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-rule bg-surface px-4 py-3">
                        <span className="text-[15px]">
                          <span className="font-medium">{inLang(sc.label, lang)}</span>
                          <span className="text-muted"> · {sc.date ? formatDateIN(sc.date, lang) : L.noDate[lang]}{sc.institution ? ` · ${sc.institution}` : ''}</span>
                        </span>
                        <span className="text-sm text-muted">{L.scanNote[lang]}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby="absent-h" className="grid gap-5">
                <SectionHeader title={<span id="absent-h">{L.absentHead[lang]}</span>} description={t('absentIntro')} />
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

              {p.errata && (
                <section aria-labelledby="errata-h" className="grid gap-5">
                  <SectionHeader title={<span id="errata-h">{t('errataTitle')}</span>} description={t('errataIntro')} />
                  <ul className="grid gap-2">
                    {p.errata.map((x, i) => (
                      <li key={i} className="border-l-[3px] border-l-madder pl-3 text-[15px]">
                        {t('errataLine', { label: inLang(x.label, lang), date: x.date ? formatDateIN(istDate(x.date), lang) : '—', n: x.withdrawn })}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

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
