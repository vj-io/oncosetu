import { redirect } from 'next/navigation'
import { PatientShell } from '@/components/shell'
import { LoginForm } from '@/components/portal/LoginForm'
import { Kicker } from '@/components/portal/ui'
import { tp } from '@/i18n/patient'
import { isDemo } from '@/server/demo'
import { langParam, type PortalSearch } from '@/server/portal/context'
import { getSession } from '@/server/session'

export default async function PatientLoginPage({ searchParams }: { searchParams: PortalSearch }) {
  const s = await getSession()
  const chosen = langParam((await searchParams).lang)
  const lang = chosen ?? 'en'
  if (s && s.kind !== 'staff') redirect(chosen ? `/p?lang=${chosen}` : '/p')
  return (
    // Not signed in: the neutral brand always (nothing is known about this visitor's disclosure status).
    <PatientShell brand="Setu Records" lang={lang} displayName="">
      <Kicker lang={lang}>{tp(lang, 'loginKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em]">{tp(lang, 'loginTitle')}</h1>
      <p className="mt-3 text-muted">{tp(lang, 'loginIntro')}</p>
      <LoginForm lang={lang} langChosen={chosen !== null} demo={isDemo()} />
      <p className="mt-8 text-[15px] text-muted">{tp(lang, 'loginHelp')}</p>
    </PatientShell>
  )
}
