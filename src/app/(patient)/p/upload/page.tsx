import { ExternalLink, FileText, Mail, MessageCircle } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { UploadForm } from '@/components/portal/UploadForm'
import { tp } from '@/i18n/patient'
import { withOrg } from '@/db'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { loadForwarding } from '@/server/portal/home'
import { buildSent, loadSentPapers } from '@/server/portal/sent'

export default async function UploadPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const [fwd, sentRows] = await withOrg(ctx.session.orgId, (tx) => Promise.all([loadForwarding(tx, ctx.session.patientId), loadSentPapers(tx, ctx.session)]))
  const sent = buildSent(sentRows, lang)
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

      {/* everything this person sent, and what became of it: a paper held or not filed no longer vanishes */}
      <section aria-labelledby="sent-h" className="mt-8 overflow-hidden rounded-xl border border-edge bg-surface shadow-card" data-testid="papers-sent">
        <h2 id="sent-h" className="border-b border-rule bg-alcove px-4 py-3 text-[1.25rem] leading-tight">{tp(lang, 'sentTitle')}</h2>
        <div className="p-4">
          <p className="max-w-prose text-muted">{tp(lang, 'sentIntro')}</p>
          {sent.length === 0 ? <p className="mt-3 text-muted">{tp(lang, 'sentEmpty')}</p> : (
            <ul className="mt-3 grid divide-y divide-rule">
              {sent.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" data-state={r.state}>
                  <FileText aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[17px] break-words">{r.name}</span>
                    <span className="text-[16px] text-muted">{r.sent} · <span className={r.state === 'filed' ? 'text-sage-ink' : r.state === 'checking' ? '' : 'text-madder-ink'}>{r.status}</span></span>
                    {r.open && (
                      <a href={`/api/documents/${r.id}/file`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 justify-self-start text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4">
                        <ExternalLink aria-hidden className="size-4" />{tp(lang, 'openPaper')}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* forwarding is shown as working only when this clinic has switched it on; otherwise one honest line */}
      <section aria-labelledby="fwd-h" className="mt-8 overflow-hidden rounded-xl border border-edge bg-surface shadow-card">
        <h2 id="fwd-h" className="border-b border-rule bg-alcove px-4 py-3 text-[1.25rem] leading-tight">{tp(lang, 'forwardSoonTitle')}</h2>
        <div className="p-4">
          {forwardingOn ? (
            <>
              <p className="max-w-prose text-muted">{tp(lang, 'forwardIntro')}</p>
              <ul className="mt-4 grid divide-y divide-rule">
                {fwd.whatsapp && (
                  <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <MessageCircle aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                    <span className="text-[17px]">{tp(lang, 'forwardWhatsApp', { number: fwd.whatsapp })}</span>
                  </li>
                )}
                {fwd.email && (
                  <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <Mail aria-hidden className="mt-1 size-5 shrink-0 text-faint" />
                    <span className="min-w-0 text-[17px] break-words">{tp(lang, 'forwardEmail', { address: fwd.email })}</span>
                  </li>
                )}
              </ul>
            </>
          ) : (
            <p className="max-w-prose text-muted">{tp(lang, 'forwardSoon')}</p>
          )}
        </div>
      </section>
    </PortalFrame>
  )
}
