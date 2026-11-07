import Link from 'next/link'
import { Download } from 'lucide-react'
import { Button, ButtonLink, EmptyState, Field, Input, SectionHeader, Select, Table } from '@/components/ui'
import { VerifyChain } from '@/components/admin/VerifyChain'
import { withOrg } from '@/db'
import { auditFacets, queryAudit, type AuditFilter } from '@/server/admin/audit-view'
import { describeAction, describeTarget } from '@/core/doctor/audit-words'
import { istDateTime, shortId } from '@/server/admin/format'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Audit log · Admin · OncoSetu' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireStaff(sectionRoles('audit'))
  const sp = await searchParams
  const f: AuditFilter = { actorId: one(sp.actor), action: one(sp.action), targetType: one(sp.type), from: one(sp.from), to: one(sp.to) }
  const page = Math.max(1, Number(one(sp.page)) || 1)
  const { facets, result } = await withOrg(s.orgId, async (tx) => ({ facets: await auditFacets(tx, s.orgId), result: await queryAudit(tx, s.orgId, f, page) }))
  const names = new Map(facets.people.map((p) => [p.id, p.name]))
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ actor: f.actorId, action: f.action, type: f.targetType, from: f.from, to: f.to, ...extra })) if (v) p.set(k, String(v))
    return p.toString()
  }
  const filtered = Object.values(f).some(Boolean)

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Audit" title="Audit log"
        description="A tamper-proof log: entries are only ever added, and each is linked to the one before it, so any edit would show. Entries carry ids and categories only, never names, quotes or file contents. Times are India time."
        actions={<ButtonLink href={`/api/admin/audit.csv${qs({}) ? `?${qs({})}` : ''}`} variant="secondary" icon={<Download aria-hidden />} prefetch={false}>Export CSV</ButtonLink>} />

      <VerifyChain />

      <form method="get" className="grid gap-4 border border-rule bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Audit filters">
        <Field label="Who"><Select name="actor" defaultValue={f.actorId ?? ''}><option value="">Anyone</option>{facets.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</Select></Field>
        <Field label="What happened"><Select name="action" defaultValue={f.action ?? ''}><option value="">Any action</option>{facets.actions.map((a) => <option key={a} value={a}>{describeAction(a)}</option>)}</Select></Field>
        <Field label="About"><Select name="type" defaultValue={f.targetType ?? ''}><option value="">Any target</option>{facets.targetTypes.map((a) => <option key={a} value={a}>{describeTarget(a)}</option>)}</Select></Field>
        <Field label="From"><Input type="date" name="from" defaultValue={f.from ?? ''} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={f.to ?? ''} /></Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit">Apply filters</Button>
          {filtered && <ButtonLink href="/admin/audit" variant="ghost">Clear</ButtonLink>}
        </div>
      </form>

      {result.rows.length === 0 ? <EmptyState title="No audit entries match" description="Widen the date range or clear a filter." /> : (
        <>
          <p className="font-mono text-sm text-muted" role="status">{result.total.toLocaleString('en-IN')} entries · page {Math.min(page, result.pages)} of {result.pages}</p>
          <Table caption="Audit entries, newest first">
            <thead><tr><th>No.</th><th>When</th><th>Who</th><th>What happened</th><th>About</th><th>Details (codes only)</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-[13px] tabular-nums">{r.seq}</td>
                  <td className="font-mono text-[13px] whitespace-nowrap">{istDateTime(r.at)}</td>
                  <td><span className="block">{r.actorId ? (names.get(r.actorId) ?? <span className="font-mono text-[13px]">{shortId(r.actorId)}</span>) : 'System'}</span><span className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">{r.actorRole}</span></td>
                  <td className="text-[14px]">{describeAction(r.action)}</td>
                  <td className="text-[14px]">{describeTarget(r.targetType)}{r.targetId && <span className="block text-faint" title={r.targetId}>{shortId(r.targetId)}</span>}</td>
                  <td className="max-w-64 font-mono text-[12px] break-all text-muted">{Object.keys(r.details).length ? JSON.stringify(r.details) : '—'}</td>
                  <td className="font-mono text-[12px] text-faint" title={r.hash}>{r.hash.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <nav aria-label="Audit pages" className="flex flex-wrap items-center gap-2">
            {page > 1 && <ButtonLink href={`/admin/audit?${qs({ page: page - 1 })}`} variant="secondary">Newer</ButtonLink>}
            {page < result.pages && <ButtonLink href={`/admin/audit?${qs({ page: page + 1 })}`} variant="secondary">Older</ButtonLink>}
          </nav>
        </>
      )}
      <p className="text-sm text-faint"><Link href="/admin" className="underline">Back to overview</Link></p>
    </div>
  )
}
