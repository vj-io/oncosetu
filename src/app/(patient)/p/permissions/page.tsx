import { Check, Minus } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { tv, type PrivacyKey } from '@/i18n/privacy'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { matrix, MATRIX_ROLES } from '@/server/rbac-matrix'

export default async function PermissionsPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const rows = matrix()
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tv(lang, 'whoKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tv(lang, 'whoTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tv(lang, 'whoIntro')}</p>
      <div className="mt-8 overflow-x-auto border border-rule bg-surface" tabIndex={0} role="region" aria-label={tv(lang, 'whoTitle')}>
        <table className="w-full min-w-[44rem] border-collapse text-left text-[15px]" data-testid="access-matrix">
          <thead>
            <tr className="border-b border-rule bg-alcove">
              <th scope="col" className="px-3 py-3 font-medium">{tv(lang, 'rolesHeader')}</th>
              {rows.map((r) => <th key={r.key} scope="col" className="px-3 py-3 text-center font-medium">{tv(lang, `a_${r.key}` as PrivacyKey)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {MATRIX_ROLES.map((role, i) => (
              <tr key={role}>
                <th scope="row" className="px-3 py-3 font-medium">{tv(lang, `r_${role}` as PrivacyKey)}</th>
                {rows.map((r) => {
                  const c = r.cells[i]
                  return (
                    <td key={r.key} className="px-3 py-3 text-center" data-cell={c}>
                      {c === 'yes' ? <Check aria-hidden className="mx-auto size-4 text-sage-ink" /> : c === 'limited' ? <Minus aria-hidden className="mx-auto size-4 text-amber-ink" /> : null}
                      <span className={c === 'no' ? 'text-muted' : ''}>{tv(lang, c)}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="notes-h" className="mt-8 grid gap-2">
        <h2 id="notes-h" className="text-xl">{tv(lang, 'whoNotesTitle')}</h2>
        <ul className="grid gap-2 text-[15px] text-muted">
          {(['note1', 'note2', 'note3', 'note4'] as const).map((k) => <li key={k}>{tv(lang, k)}</li>)}
        </ul>
      </section>
    </PortalFrame>
  )
}
