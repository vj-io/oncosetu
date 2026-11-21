import Link from 'next/link'
import { ArrowUpRight, ChartColumn, ClipboardList, Copy, Eraser, History, ListChecks, ShieldAlert, Siren, Users } from 'lucide-react'
import { ADMIN_GROUPS, groupsFor, PLAIN_LABEL } from '@/components/admin/groups'
import { ActionList, BarList, Panel, SectionHeader, StatTile, type ActionItem } from '@/components/ui'
import { withOrg } from '@/db'
import { SAFETY_KINDS, SAFETY_META } from '@/core/doctor/safety-events'
import { duplicateCounts, overviewCounts } from '@/server/admin/ops'
import { listErasureRequests } from '@/server/erasure/erasure'
import { plural } from '@/server/admin/format'
import { loadSafetyEvents } from '@/server/admin/safety'
import { now } from '@/server/clock'
import { SECTIONS, type SectionKey } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Admin · OncoSetu' }

export default async function AdminOverview() {
  const s = await requireStaff(SECTIONS.overview.roles)
  const admin = s.role === 'org_admin'
  const { c, d, safety, erasures } = await withOrg(s.orgId, async (tx) => ({ c: await overviewCounts(tx, s.orgId), erasures: admin ? (await listErasureRequests(tx, s.orgId).catch(() => [])).filter((r) => r.state === 'queued' || r.state === 'scheduled').length : null, d: admin ? await duplicateCounts(tx, s.orgId).catch(() => null) : null, // one unreadable row must not take the whole overview down
    safety: await loadSafetyEvents(tx, s.orgId, await now(s.orgId), 0) }))
  // The same total as the Blocked and held page, with its three biggest kinds named (never a fixed pair).
  const top = SAFETY_KINDS.filter((k) => safety.counts[k] > 0).sort((a, b) => safety.counts[b] - safety.counts[a]).slice(0, 3)
    .map((k) => `${safety.counts[k]} ${SAFETY_META[k].label.toLowerCase()}`).join(', ')

  const note: Record<SectionKey, { value: string; note: string }> = {
    overview: { value: '', note: '' },
    safety: { value: `${safety.total}`, note: `${safety.total === 1 ? 'event' : 'events'} in ${safety.days} days${top ? `: ${top}` : ''}` },
    staff: { value: `${c.staff}`, note: 'active staff accounts' },
    rules: { value: c.rulesProduction === c.rulesTotal ? `All ${c.rulesTotal}` : `${c.rulesProduction} of ${c.rulesTotal}`, note: c.rulesProduction === c.rulesTotal ? 'missing-papers checks reviewed by a clinician and in use' : 'missing-papers checks in use; the rest are with a clinician for review' },
    audit: { value: c.audit.toLocaleString('en-IN'), note: 'entries in the activity log. Entries can be added, never changed' },
    metrics: { value: '', note: 'how well it works, and the safety numbers that must stay at zero' },
    measurement: { value: `${c.forms}`, note: 'consultation forms filled in for the study' },
    devices: { value: `${c.devices}`, note: `capture ${plural(c.devices, 'device')} in use` },
    duplicates: { value: d ? `${d.candidates} likely` : '—', note: d ? `${d.pendingMerges} merge${d.pendingMerges === 1 ? '' : 's'} waiting for a second person to approve` : 'org admin only' },
    breakGlass: { value: `${c.breakGlassActive} open`, note: 'times staff opened a record without consent, with a reason' },
    erasure: { value: erasures == null ? '' : `${erasures} waiting`, note: 'patients who asked for their records to be erased' },
    settings: { value: '', note: 'switches, how long records are kept, daily limits' },
  }
  const groups = groupsFor(s.role)
  const waiting = c.rulesTotal - c.rulesProduction
  const actions: ActionItem[] = admin ? [
    ...(c.breakGlassActive ? [{ href: '/admin/break-glass', label: 'Emergency access open now', icon: <Siren />, count: c.breakGlassActive, urgent: true }] : []),
    ...(d?.pendingMerges ? [{ href: '/admin/duplicates', label: 'Merges to approve or refuse', icon: <Copy />, count: d.pendingMerges, urgent: true }] : []),
    ...(erasures ? [{ href: '/admin/erasure', label: 'Erasure requests to handle', icon: <Eraser />, count: erasures, tone: 'unverified' as const }] : []),
    ...(d?.candidates ? [{ href: '/admin/duplicates', label: 'Likely duplicate records', icon: <Copy />, count: d.candidates, tone: 'unverified' as const }] : []),
    ...(waiting ? [{ href: '/admin/rules', label: 'Checks with a clinician for review', icon: <ListChecks />, count: waiting, tone: 'shadow' as const }] : []),
  ] : [
    { href: '/admin/break-glass', label: 'Emergency access open now', icon: <Siren />, count: c.breakGlassActive, urgent: c.breakGlassActive > 0 },
    { href: '/admin/audit', label: 'Read the activity log', icon: <History /> },
    { href: '/admin/metrics', label: 'Check the metrics', icon: <ChartColumn /> },
  ]

  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker={`${admin ? 'Admin' : 'Audit'} · ${s.orgName}`} title={admin ? 'Admin' : 'Audit and oversight'}
        description={admin ? 'Five areas. Every change made here is written to the activity log, without names or document text.' : 'Two areas you can review: safety and activity, and quality. You cannot open patient records or change settings.'} />
      <ul aria-label="At a glance" className="ds-feature rounded-2xl border border-rule p-3 shadow-card sm:p-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <li><StatTile tone="conflict" icon={<ShieldAlert />} value={safety.total} label="Blocked and held" sub={`In the last ${safety.days} days`} href="/admin/safety" /></li>
        {admin
          ? <li><StatTile icon={<Users />} value={c.staff} label="Active staff" sub="Accounts that can sign in" href="/admin/staff" /></li>
          : <li><StatTile tone="unverified" icon={<Siren />} value={c.breakGlassActive} label="Emergency access open" sub="Opened without consent, with a reason" href="/admin/break-glass" /></li>}
        {admin
          ? <li><StatTile tone="verified" icon={<ListChecks />} value={`${c.rulesProduction} of ${c.rulesTotal}`} label="Missing-papers checks in use" sub={waiting ? `${waiting} with a clinician for review` : 'All reviewed by a clinician'} href="/admin/rules" /></li>
          : <li><StatTile tone="verified" icon={<ClipboardList />} value={c.forms} label="Study forms filled" sub="One per sealed consultation" href="/admin/measurement" /></li>}
        <li><StatTile tone="shadow" icon={<History />} value={c.audit.toLocaleString('en-IN')} label="Activity log entries" sub="Added, never changed" href="/admin/audit" /></li>
      </ul>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={`Blocked and held, last ${safety.days} days`} icon={<ShieldAlert />} id="safety-glance" aside={<Link href="/admin/safety" className="text-sm font-medium text-setu-ink underline decoration-link underline-offset-4">Open the list</Link>}>
          {safety.total === 0
            ? <p className="text-[15px] text-muted">Nothing was blocked or held in the last {safety.days} days.</p>
            : <BarList label={`Blocked and held events in the last ${safety.days} days, by kind`} items={SAFETY_KINDS.filter((k) => safety.counts[k] > 0).map((k) => ({ label: SAFETY_META[k].label, value: safety.counts[k], tone: SAFETY_META[k].tone, href: '/admin/safety' }))} />}
          {safety.total > 0 && <p className="text-[13px] text-muted">Kinds with nothing in this period are not listed.</p>}
        </Panel>
        <Panel tint title={admin ? 'Waiting for a decision' : 'Where to look'} icon={<ClipboardList />} id="waiting">
          <ActionList items={actions} empty="Nothing is waiting for a decision." />
        </Panel>
      </div>
      <section aria-labelledby="areas" className="grid gap-3">
        <h2 id="areas" className="text-xl">All areas</h2>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {groups.map((g) => {
            const def = ADMIN_GROUPS.find((x) => x.id === g.id)!
            return (
              <section key={g.id} aria-labelledby={`g-${g.id}`} className="grid gap-3 rounded-xl border border-rule bg-surface p-5 shadow-card">
                <div className="grid gap-0.5">
                  <h3 id={`g-${g.id}`} className="text-lg font-semibold">{g.title}</h3>
                  <p className="text-sm text-muted">{def.blurb}</p>
                </div>
                <ul className="-mx-2 grid">
                  {def.sections.filter((k) => (SECTIONS[k].roles as readonly string[]).includes(s.role)).map((k) => (
                    <li key={k}>
                      <Link href={SECTIONS[k].href} className="group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-2 hover:bg-alcove">
                        <span className="grid gap-0.5">
                          <span className="font-medium">{PLAIN_LABEL[k]}</span>
                          <span className="text-[13px] leading-snug text-muted">{note[k].note}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {note[k].value && <span className="font-semibold tabular-nums">{note[k].value}</span>}
                          <ArrowUpRight aria-hidden className="size-4 text-faint group-hover:text-ink" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </section>
    </div>
  )
}
