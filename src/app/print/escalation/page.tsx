// "If the hospital has not responded" (FR-REQ-04): information only, not legal advice. No patient data on it.
import type { Metadata } from 'next'
import { PrintSheet } from '@/components/requests/PrintSheet'
import type { Lang } from '@/core/types'
import { tr, type RequestKey } from '@/i18n/requests'

export const metadata: Metadata = { title: 'Setu Records', robots: { index: false, follow: false } }

const STEPS: [RequestKey, RequestKey][] = [['escStep1Title', 'escStep1Text'], ['escStep2Title', 'escStep2Text'], ['escStep3Title', 'escStep3Text']]

export default async function EscalationSheet({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === 'hi' ? 'hi' : 'en'
  return (
    <PrintSheet lang={lang} langHref={(l) => `/print/escalation?lang=${l}`}>
      <header className="border-b-2 border-ink pb-4"><p className="font-display text-xl tracking-[-0.02em]">Setu Records</p></header>
      <h1 className="mt-6 text-[1.6rem] leading-tight tracking-[-0.02em]">{tr(lang, 'escTitle')}</h1>
      <p className="mt-3 text-muted">{tr(lang, 'escIntro')}</p>
      <ol className="mt-6 grid gap-5">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="grid grid-cols-[2rem_1fr] gap-3 break-inside-avoid">
            <span className="font-mono text-sm text-faint">{String(i + 1).padStart(2, '0')}</span>
            <div className="grid gap-1"><h2 className="text-lg">{tr(lang, title)}</h2><p>{tr(lang, text)}</p></div>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-l-[3px] border-l-brass pl-3">{tr(lang, 'escKeep')}</p>
      <p className="mt-6 border-t border-rule pt-3 text-[13px] text-muted">{tr(lang, 'escNotAdvice')}</p>
    </PrintSheet>
  )
}
