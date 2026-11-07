import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PatientShell } from '@/components/shell'
import { LoginForm } from '@/components/portal/LoginForm'
import { Kicker } from '@/components/portal/ui'
import { tp } from '@/i18n/patient'
import { isDemo } from '@/server/demo'
import { safePortalNext } from '@/lib/safe-next'
import { browserLang, langParam } from '@/server/portal/context'
import { getSession } from '@/server/session'

/** `next` is only ever a same-origin /p path (safePortalNext); `?lang=` rides along when the visitor chose one. */
const landing = (next: string | null, chosen: string | null) =>
  !next ? (chosen ? `/p?lang=${chosen}` : '/p') : chosen && !next.includes('lang=') ? `${next}${next.includes('?') ? '&' : '?'}lang=${chosen}` : next

export default async function PatientLoginPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[]; next?: string | string[]; station?: string | string[] }> }) {
  const s = await getSession()
  const sp = await searchParams
  const chosen = langParam(sp.lang)
  const next = safePortalNext(sp.next)
  const lang = chosen ?? (await browserLang()) // after sign-in the patient's own preferred language applies
  // Desk station (FR-VOX-02): the shared clinic tablet goes straight to the questions and signs itself out after.
  const station = sp.station === '1'
  const after = station ? `/p/visit?station=1${chosen ? `&lang=${chosen}` : ''}` : landing(next, chosen)
  if (s && s.kind !== 'staff') redirect(after)
  return (
    // Not signed in: the neutral brand always (nothing is known about this visitor's disclosure status).
    <PatientShell brand="Setu Records" lang={lang} displayName="" homeHref={`/p/login${station ? '?station=1' : chosen ? `?lang=${chosen}` : ''}`}>
      <Kicker lang={lang}>{tp(lang, station ? 'stationKicker' : 'loginKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em]">{tp(lang, station ? 'stationTitle' : 'loginTitle')}</h1>
      <p className="mt-3 text-muted">{tp(lang, station ? 'stationIntro' : 'loginIntro')}</p>
      <LoginForm lang={lang} demo={isDemo()} after={after} station={station} />
      <p className="mt-8 text-[16px] text-muted">{tp(lang, 'loginHelp')}</p>
      <p className="mt-3 text-[16px] text-muted">
        {tp(lang, 'staffLinkText')}{' '}
        <Link href="/login" data-testid="staff-login-link" className="inline-flex min-h-11 items-center text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">{tp(lang, 'staffLinkCta')}</Link>
      </p>
    </PatientShell>
  )
}
