import { Check, Minus } from 'lucide-react'
import { PortalFrame } from '@/components/portal/PortalFrame'
import { Kicker } from '@/components/portal/ui'
import { en, tp, type PatientKey } from '@/i18n/patient'
import { tv, type PrivacyKey } from '@/i18n/privacy'
import { loadPortal, type PortalSearch } from '@/server/portal/context'
import { matrix, MATRIX_ROLES } from '@/server/rbac-matrix'

export default async function PermissionsPage({ searchParams }: { searchParams: PortalSearch }) {
  const ctx = await loadPortal(searchParams)
  const { lang } = ctx
  const rows = matrix()
  // plain wording for the jargon rows ("seal a snapshot", "audit log", "break-glass"), the shared words for the rest
  const action = (key: string) => (`perm_a_${key}` in en ? tp(lang, `perm_a_${key}` as PatientKey) : tv(lang, `a_${key}` as PrivacyKey))
  const note = (k: string) => (k === 'note1' || k === 'note3' ? tp(lang, `perm_${k}` as PatientKey) : tv(lang, k as PrivacyKey))
  // on a phone: one card per role, the patient's own rows first
  const order = [...MATRIX_ROLES.keys()].sort((a, b) => Number(!['patient', 'caregiver'].includes(MATRIX_ROLES[a])) - Number(!['patient', 'caregiver'].includes(MATRIX_ROLES[b])) || a - b)
  const group = (i: number, cell: string) => rows.filter((r) => r.cells[i] === cell)
  return (
    <PortalFrame ctx={ctx}>
      <Kicker lang={lang}>{tv(lang, 'whoKicker')}</Kicker>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em] sm:text-4xl">{tv(lang, 'whoTitle')}</h1>
      <p className="mt-3 max-w-prose text-muted">{tv(lang, 'whoIntro')}</p>
      <ul className="mt-8 grid gap-3 md:hidden" data-testid="access-cards">
        {order.map((i) => (
          <li key={MATRIX_ROLES[i]} className="grid gap-3 border border-rule bg-surface px-4 py-4">
            <h2 className="text-xl">{tv(lang, `r_${MATRIX_ROLES[i]}` as PrivacyKey)}</h2>
            {([['yes', 'permCan'], ['limited', 'permPart'], ['no', 'permCannot']] as const).map(([cell, label]) => {
              const items = group(i, cell)
              return items.length ? (
                <div key={cell}>
                  <p className="text-[16px] font-medium">{tp(lang, label)}</p>
                  <ul className="mt-1 grid gap-1 text-[16px]">
                    {items.map((r) => (
                      <li key={r.key} className="flex items-start gap-2">
                        {cell === 'yes' ? <Check aria-hidden className="mt-1 size-4 shrink-0 text-sage-ink" /> : cell === 'limited' ? <Minus aria-hidden className="mt-1 size-4 shrink-0 text-amber-ink" /> : <span aria-hidden className="mt-1 size-4 shrink-0 text-center text-muted">·</span>}
                        <span className={cell === 'no' ? 'text-muted' : ''}>{action(r.key)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            })}
          </li>
        ))}
      </ul>
      <div className="mt-8 hidden overflow-x-auto border border-rule bg-surface md:block" tabIndex={0} role="region" aria-label={tv(lang, 'whoTitle')}>
        <table className="w-full min-w-[44rem] border-collapse text-left text-[16px]" data-testid="access-matrix">
          <thead>
            <tr className="border-b border-rule bg-alcove">
              <th scope="col" className="px-3 py-3 font-medium">{tv(lang, 'rolesHeader')}</th>
              {rows.map((r) => <th key={r.key} scope="col" className="px-3 py-3 text-center font-medium">{action(r.key)}</th>)}
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
        <ul className="grid gap-2 text-[16px] text-muted">
          {(['note1', 'note2', 'note3', 'note4'] as const).map((k) => <li key={k}>{note(k)}</li>)}
        </ul>
      </section>
    </PortalFrame>
  )
}
