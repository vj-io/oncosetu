// A4 sheet frame shared by the request letter, the escalation sheet and the passport: a toolbar on screen, nothing but the page on paper.
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Lang } from '@/core/types'
import { tr } from '@/i18n/requests'
import { PrintButton } from './PrintButton'

const PRINT_CSS = '@page { size: A4; margin: 16mm } @media print { html, body { background: #fff !important } }'

export function PrintSheet({ lang, langHref, actions, children }: { lang: Lang; langHref: (l: Lang) => string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div lang={lang} className={`min-h-dvh bg-alcove py-6 print:bg-white print:py-0 ${lang === 'hi' ? 'font-deva' : ''}`}>
      <style>{PRINT_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 px-4 print:hidden">
        <PrintButton label={tr(lang, 'printButton')} />
        <nav aria-label="Language · भाषा" className="flex gap-1">
          {(['en', 'hi'] as const).map((l) => (
            <Link key={l} href={langHref(l)} aria-current={l === lang ? 'page' : undefined}
              className={`inline-flex h-11 items-center border border-ink px-3 ${l === lang ? 'bg-obsidian text-gallery' : 'bg-matte hover:bg-spotlight'} ${l === 'hi' ? 'font-deva' : 'font-mono text-xs tracking-[0.14em]'}`}>
              {l === 'en' ? 'EN' : 'हिं'}
            </Link>
          ))}
        </nav>
        {actions}
      </div>
      <article className="mx-auto max-w-[210mm] bg-white px-[12mm] py-[14mm] text-[15px] leading-relaxed text-ink shadow-frame sm:px-[18mm] print:max-w-none print:p-0 print:shadow-none">
        {children}
      </article>
    </div>
  )
}
