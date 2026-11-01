import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { UploadForm } from '@/components/portal/UploadForm'
import { tp } from '@/i18n/patient'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function UploadPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'uploadKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'uploadTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'uploadIntro')}</p>
      <UploadForm lang={lang} canStore={!!ctx.consent?.purposes.store} />
    </PortalFrame>
  )
}
