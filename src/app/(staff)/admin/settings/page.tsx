import { KeyValue, SectionHeader } from '@/components/ui'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { withOrg } from '@/db'
import { DAY_S, LLM_BUDGET_MAX, loadSettings, MIN_RETENTION_DAYS } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { llmStatus } from '@/server/ai/provider'
import { llmUsage, orgLlmUsage } from '@/server/ai/quota'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Settings · Admin · OncoSetu' }

export default async function SettingsPage() {
  const s = await requireStaff(sectionRoles('settings'))
  const { st, orgUse } = await withOrg(s.orgId, async (tx) => ({ st: await loadSettings(tx, s.orgId), orgUse: await orgLlmUsage(tx) }))
  const llm = llmStatus(!!st.flags.ai_extraction)
  const usage = llm.provider === 'google' ? await llmUsage() : null // shared across every org on the free-tier key
  const n = (x: number) => x.toLocaleString('en-IN')
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Settings" title="Organisation settings" description="Feature flags, the retention period and, in demo mode only, the demo clock." />
      <section aria-labelledby="llm-h" className="grid gap-3 border border-rule bg-matte p-5 shadow-frame">
        <h2 id="llm-h" className="font-display text-xl">AI-assisted reading</h2>
        <p className="text-muted">{llm.label}. Only for patients who consented; every result still passes the same evidence check and a person verifies it.</p>
        <KeyValue items={[
          ...(usage ? [{ label: 'Shared key', value: `${usage.today} of ${usage.limits.rpd} calls used today (all organisations)` }] : []),
          { label: 'Calls', value: `${n(orgUse.calls)} of ${n(st.llmBudget.calls)} used today` },
          { label: 'Tokens', value: `${n(orgUse.tokens)} of ${n(st.llmBudget.tokens)} used today` },
        ]} />
      </section>
      <p className="text-[15px] text-muted"><a className="underline underline-offset-4" href="/security">Security & compliance</a>: what is built against HIPAA safeguards, the DPDP Act and ABDM, and what is planned.</p>
      <SettingsForm flags={st.flags} retentionDays={st.retentionDays} minRetentionDays={MIN_RETENTION_DAYS} demo={st.demo} demoOffsetDays={Math.round(st.demoClockOffsetS / DAY_S)}
        llmBudget={st.llmBudget} llmBudgetMax={LLM_BUDGET_MAX} />
    </div>
  )
}
