import { ShieldAlert } from 'lucide-react'
import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { SAFETY_KINDS, SAFETY_META } from '@/core/doctor/safety-events'
import { istDateTime } from '@/server/admin/format'
import { loadSafetyEvents } from '@/server/admin/safety'
import { sectionRoles } from '@/server/admin/sections'
import { now } from '@/server/clock'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Blocked and held · Admin · OncoSetu' }

export default async function SafetyEventsPage() {
  const s = await requireStaff(sectionRoles('safety'))
  const data = await withOrg(s.orgId, async (tx) => loadSafetyEvents(tx, s.orgId, await now(s.orgId)))
  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader
        as="h1" kicker="Admin · Safety events" title="Blocked and held"
        description={`Everything the system stopped, held back or refused in the last ${data.days} days, in plain words. Nothing here is hidden: it is read from the tamper-proof activity log.`}
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Counts by kind">
        {SAFETY_KINDS.map((k) => (
          <li key={k} className="grid content-start gap-1 border border-rule bg-surface px-4 py-3">
            <span className="font-display text-2xl leading-none tabular-nums">{data.counts[k]}</span>
            <span className="text-[13px] text-muted">{SAFETY_META[k].label}</span>
          </li>
        ))}
      </ul>
      {data.rows.length === 0 ? (
        <EmptyState icon={<ShieldAlert />} title="Nothing blocked or held" description="When the system refuses or holds something, it appears here with the time and who was involved." />
      ) : (
        <Table caption={`${data.total} event${data.total === 1 ? '' : 's'}, newest first${data.total > data.rows.length ? ` (showing ${data.rows.length})` : ''}`}>
          <thead><tr><th>When</th><th>What happened</th><th>Who</th><th>Patient</th></tr></thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="font-mono text-[13px] whitespace-nowrap">{istDateTime(r.at)}</td>
                <td className="min-w-64">
                  <Badge tone={SAFETY_META[r.kind].tone}>{r.title}</Badge>
                  <span className="mt-1.5 block text-[15px]">{r.detail}</span>
                </td>
                <td className="text-[15px]">{r.who}</td>
                <td className="font-mono text-[13px]">{r.patientCode ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-sm text-faint">Patients appear by their record code only. Administrators and auditors cannot open patient records; use the audit log for the full trail.</p>
    </div>
  )
}
