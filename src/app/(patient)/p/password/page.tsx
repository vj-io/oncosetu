import { PasswordForm } from '@/components/portal/PasswordForm'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function PasswordPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'pwKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'pwTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted" data-testid="pw-intro">{tp(lang, ctx.hasPassword ? 'pwIntroChange' : 'pwIntroNew')}</p>
      <PasswordForm lang={lang} />
    </PortalFrame>
  )
}
