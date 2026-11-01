import { Eye } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { EmptyState } from '@/components/ui'
import { withOrg } from '@/db'
import { tp } from '@/i18n/patient'
import { loadAccessLog } from '@/server/portal/access'
import { loadPortal, type PortalSearch } from '@/server/portal/context'

export default async function AccessPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const log = await withOrg(ctx.session.orgId, (tx) => loadAccessLog(tx, ctx.session.patientId, lang, ctx.session.kind === 'patient'))
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tp(lang, 'accessKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tp(lang, 'accessTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tp(lang, 'accessIntro')}</p>
      {log.length === 0 ? (
        <EmptyState className="mt-8" icon={<Eye />} title={tp(lang, 'accessEmpty')} />
      ) : (
        <>
          <ol className="mt-8 divide-y divide-rule border border-rule bg-surface">
            {log.map((e) => (
              <li key={e.id} className="grid gap-0.5 px-4 py-3">
                <span className="text-[17px] leading-snug">{e.text}</span>
                <span className="text-[15px] text-muted">{e.at}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[15px] text-muted">{tp(lang, 'accessNote')}</p>
        </>
      )}
    </PortalFrame>
  )
}
