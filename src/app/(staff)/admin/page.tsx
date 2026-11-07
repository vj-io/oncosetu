import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { SectionHeader } from '@/components/ui'
import { withOrg } from '@/db'
import { duplicateCounts, overviewCounts } from '@/server/admin/ops'
import { loadSafetyEvents } from '@/server/admin/safety'
import { now } from '@/server/clock'
import { SECTIONS, type SectionKey } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Admin · OncoSetu' }

export default async function AdminOverview() {
  const s = await requireStaff(SECTIONS.overview.roles)
  const admin = s.role === 'org_admin'
  const { c, d, safety } = await withOrg(s.orgId, async (tx) => ({ c: await overviewCounts(tx, s.orgId), d: admin ? await duplicateCounts(tx, s.orgId) : null, safety: await loadSafetyEvents(tx, s.orgId, await now(s.orgId), 0) }))
  const stopped = safety.counts.wrong_patient + safety.counts.hidden_instructions + safety.counts.handwriting + safety.counts.role_refused + safety.counts.no_consent + safety.counts.share_refused + safety.counts.upload_rejected + safety.counts.sms_limit + safety.counts.id_number_rejected

  const tiles: { key: SectionKey; value: string; note: string }[] = [
    { key: 'safety', value: `${stopped}`, note: `things blocked or held in ${safety.days} days: ${safety.counts.wrong_patient} wrong-patient, ${safety.counts.hidden_instructions} hidden-instruction, ${safety.counts.break_glass} emergency-access` },
    { key: 'staff', value: `${c.staff}`, note: 'active accounts, roles, authenticators' },
    { key: 'rules', value: `${c.rulesProduction} of ${c.rulesTotal}`, note: 'missing-papers checks in use; the rest are still being reviewed by a clinician' },
    { key: 'audit', value: c.audit.toLocaleString('en-IN'), note: 'entries in the tamper-proof activity log; filter, export, check' },
    { key: 'metrics', value: 'KPIs', note: 'how well the product works, and the safety targets that must stay at zero' },
    { key: 'measurement', value: `${c.forms}`, note: 'consultation forms in the baseline study' },
    { key: 'devices', value: `${c.devices}`, note: 'registered capture devices not revoked' },
    { key: 'duplicates', value: d ? `${d.candidates} likely` : '—', note: d ? `${d.pendingMerges} merge${d.pendingMerges === 1 ? '' : 's'} waiting for a second approval` : 'org admin only' },
    { key: 'breakGlass', value: `${c.breakGlassActive} active`, note: 'clinician access outside consent, with reasons' },
    { key: 'settings', value: 'Org', note: 'feature flags, retention, demo clock' },
  ]
  const visible = tiles.filter((t) => (SECTIONS[t.key].roles as readonly string[]).includes(s.role))

  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker={`Admin · ${s.orgName}`} title="Administration console" description="Everything here is read from live records, and every change is written to the tamper-proof activity log (no names or document text)." />
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((t) => (
          <li key={t.key}>
            <Link href={SECTIONS[t.key].href} className="group grid h-full content-start gap-2 border border-rule bg-surface px-5 py-5 shadow-placard transition-colors hover:bg-spotlight">
              <span className="flex items-center justify-between">
                <span className="ds-kicker">{SECTIONS[t.key].label}</span>
                <ArrowUpRight aria-hidden className="size-4 text-faint group-hover:text-ink" />
              </span>
              <span className="font-display text-3xl tracking-[-0.03em] tabular-nums">{t.value}</span>
              <span className="text-sm text-muted">{t.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
