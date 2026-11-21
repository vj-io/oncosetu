import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { ADMIN_GROUPS, groupsFor, PLAIN_LABEL } from '@/components/admin/groups'
import { SectionHeader } from '@/components/ui'
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

  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker={`${admin ? 'Admin' : 'Audit'} · ${s.orgName}`} title={admin ? 'Admin' : 'Audit and oversight'}
        description={admin ? 'Five areas. Every change made here is written to the activity log, without names or document text.' : 'Two areas you can review: safety and activity, and quality. You cannot open patient records or change settings.'} />
      {groups.map((g) => {
        const def = ADMIN_GROUPS.find((x) => x.id === g.id)!
        return (
          <section key={g.id} aria-labelledby={`g-${g.id}`} className="grid gap-3">
            <div className="grid gap-0.5">
              <h2 id={`g-${g.id}`} className="text-xl">{g.title}</h2>
              <p className="text-sm text-muted">{def.blurb}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {def.sections.filter((k) => (SECTIONS[k].roles as readonly string[]).includes(s.role)).map((k) => (
                <li key={k}>
                  <Link href={SECTIONS[k].href} className="group grid h-full content-start gap-1.5 border border-rule bg-surface px-5 py-4 shadow-placard transition-colors hover:bg-spotlight rounded-lg">
                    <span className="flex items-center justify-between">
                      <span className="font-medium">{PLAIN_LABEL[k]}</span>
                      <ArrowUpRight aria-hidden className="size-4 text-faint group-hover:text-ink" />
                    </span>
                    {note[k].value && <span className="font-display text-2xl tracking-[-0.03em] tabular-nums">{note[k].value}</span>}
                    <span className="text-sm text-muted">{note[k].note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
