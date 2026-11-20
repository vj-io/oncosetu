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
  const forwardingOn = !!(fwd.whatsapp || fwd.email)
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'uploadKicker')}</Kicker>
      <h1 className="mt-2 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'uploadTitle')}</h1>
      <p className="mt-2 max-w-prose text-muted">{tp(lang, 'uploadIntro')}</p>

      {/* the file picker comes first: it is the one way in that always works */}
      <UploadForm lang={lang} canStore={!!ctx.consent?.purposes.store} />

      <p className="mt-6 max-w-prose text-[16px] text-muted">{tp(lang, 'uploadNoRead')}</p>
      <details className="mt-3 max-w-prose">
        <summary className="flex min-h-11 cursor-pointer items-center text-[17px] underline underline-offset-4">{tp(lang, 'uploadFormatsTitle')}</summary>
        <p data-testid="upload-formats" className="mt-1 text-[16px] text-muted">{tp(lang, 'uploadFormats')}</p>
      </details>

      {/* forwarding is shown as working only when this clinic has switched it on; otherwise one honest line */}
      <section aria-labelledby="fwd-h" className="mt-8">
        <h2 id="fwd-h" className="text-xl">{tp(lang, 'forwardSoonTitle')}</h2>
        {forwardingOn ? (
          <>
            <p className="mt-2 max-w-prose text-muted">{tp(lang, 'forwardIntro')}</p>
            <ul className="mt-4 grid gap-2">
              {fwd.whatsapp && (
                <li>
                  <Frame className="flex items-start gap-3 px-4 py-3">
                    <MessageCircle aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                    <span className="text-[17px]">{tp(lang, 'forwardWhatsApp', { number: fwd.whatsapp })}</span>
                  </Frame>
                </li>
              )}
              {fwd.email && (
                <li>
                  <Frame className="flex items-start gap-3 px-4 py-3">
                    <Mail aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                    <span className="min-w-0 text-[17px] break-words">{tp(lang, 'forwardEmail', { address: fwd.email })}</span>
                  </Frame>
                </li>
              )}
            </ul>
          </>
        ) : (
          <p className="mt-2 max-w-prose text-muted">{tp(lang, 'forwardSoon')}</p>
        )}
      </section>
    </PortalFrame>
  )
}
