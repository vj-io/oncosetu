import { KeyValue, SectionHeader } from '@/components/ui'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { withOrg } from '@/db'
import { DAY_S, loadSettings, MIN_RETENTION_DAYS } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { llmStatus } from '@/server/ai/provider'
import { llmUsage } from '@/server/ai/quota'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Settings · Admin · OncoSetu' }

export default async function SettingsPage() {
  const s = await requireStaff(sectionRoles('settings'))
  const st = await withOrg(s.orgId, (tx) => loadSettings(tx, s.orgId))
  const llm = llmStatus(!!st.flags.ai_extraction)
  const usage = llm.provider === 'google' ? await llmUsage() : null // shared across every org on the free-tier key
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Settings" title="Organisation settings" description="Feature flags, the retention period and, in demo mode only, the demo clock." />
      <section aria-labelledby="llm-h" className="grid gap-3 border border-rule bg-matte p-5 shadow-frame">
        <h2 id="llm-h" className="font-display text-xl">AI-assisted reading</h2>
        <p className="text-muted">{llm.label}. Only for patients who consented; every result still passes the same evidence check and a person verifies it.</p>
        {usage && <KeyValue items={[{ label: 'Daily limit', value: `${usage.today} of ${usage.limits.rpd} used` }]} />}
      </section>
      <SettingsForm flags={st.flags} retentionDays={st.retentionDays} minRetentionDays={MIN_RETENTION_DAYS} demo={st.demo} demoOffsetDays={Math.round(st.demoClockOffsetS / DAY_S)} />
    </div>
  )
}
