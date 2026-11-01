import { SectionHeader } from '@/components/ui'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { withOrg } from '@/db'
import { DAY_S, loadSettings, MIN_RETENTION_DAYS } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Settings · Admin · OncoSetu' }

export default async function SettingsPage() {
  const s = await requireStaff(sectionRoles('settings'))
  const st = await withOrg(s.orgId, (tx) => loadSettings(tx, s.orgId))
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Settings" title="Organisation settings" description="Feature flags, the retention period and, in demo mode only, the demo clock." />
      <SettingsForm flags={st.flags} retentionDays={st.retentionDays} minRetentionDays={MIN_RETENTION_DAYS} demo={st.demo} demoOffsetDays={Math.round(st.demoClockOffsetS / DAY_S)} />
    </div>
  )
}
