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

export default async function PatientLoginPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[]; next?: string | string[] }> }) {
  const s = await getSession()
  const sp = await searchParams
  const chosen = langParam(sp.lang)
  const next = safePortalNext(sp.next)
  const lang = chosen ?? (await browserLang()) // after sign-in the patient's own preferred language applies
  if (s && s.kind !== 'staff') redirect(landing(next, chosen))
  return (
    // Not signed in: the neutral brand always (nothing is known about this visitor's disclosure status).
    <PatientShell brand="Setu Records" lang={lang} displayName="" homeHref={`/p/login${chosen ? `?lang=${chosen}` : ''}`}>
      <Kicker lang={lang}>{tp(lang, 'loginKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em]">{tp(lang, 'loginTitle')}</h1>
      <p className="mt-3 text-muted">{tp(lang, 'loginIntro')}</p>
      <LoginForm lang={lang} demo={isDemo()} after={landing(next, chosen)} />
      <p className="mt-8 text-[15px] text-muted">{tp(lang, 'loginHelp')}</p>
      <p className="mt-3 text-[15px] text-muted">
        {tp(lang, 'staffLinkText')}{' '}
        <Link href="/login" data-testid="staff-login-link" className="inline-flex min-h-11 items-center text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">{tp(lang, 'staffLinkCta')}</Link>
      </p>
    </PatientShell>
  )
}
