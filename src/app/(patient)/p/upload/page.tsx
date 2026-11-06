import { Mail, MessageCircle } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { UploadForm } from '@/components/portal/UploadForm'
import { tp } from '@/i18n/patient'
import { Frame } from '@/components/ui'
import { withOrg } from '@/db'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadForwarding } from '@/server/portal/home'

export default async function UploadPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const fwd = await withOrg(ctx.session.orgId, (tx) => loadForwarding(tx, ctx.session.patientId))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'uploadKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'uploadTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'uploadIntro')}</p>
      <section aria-labelledby="fwd-h" className="mt-8">
        <h2 id="fwd-h" className="text-xl">{tp(lang, 'forwardTitle')}</h2>
        <p className="mt-2 max-w-prose text-muted">{tp(lang, 'forwardIntro')}</p>
        <ul className="mt-4 grid gap-2">
          <li>
            <Frame className="flex items-start gap-3 px-4 py-3">
              <MessageCircle aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
              <span className="text-[17px]">{fwd.whatsapp ? tp(lang, 'forwardWhatsApp', { number: fwd.whatsapp }) : tp(lang, 'forwardWhatsAppOff')}</span>
            </Frame>
          </li>
          <li>
            <Frame className="flex items-start gap-3 px-4 py-3">
              <Mail aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
              <span className="min-w-0 text-[17px] break-words">{fwd.email ? tp(lang, 'forwardEmail', { address: fwd.email }) : tp(lang, 'forwardEmailNone')}</span>
            </Frame>
          </li>
        </ul>
      </section>
      <UploadForm lang={lang} canStore={!!ctx.consent?.purposes.store} />
    </PortalFrame>
  )
}
