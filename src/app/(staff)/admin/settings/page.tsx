import { KeyValue, SectionHeader } from '@/components/ui'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { withOrg } from '@/db'
import { DAY_S, LLM_BUDGET_MAX, loadSettings, MIN_RETENTION_DAYS } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { llmStatus } from '@/server/ai/provider'
import { llmUsage, orgLlmUsage } from '@/server/ai/quota'
import { questionSettings } from '@/server/portal/visit-model'
import { en } from '@/i18n/patient'
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
      <SectionHeader as="h1" kicker="Admin · Settings" title="Settings" description="Switches for this hospital, how long records are kept and the daily AI limit. In demo mode there is also a demo clock." />
      <section aria-labelledby="llm-h" className="grid gap-3 border border-rule bg-matte p-5 shadow-frame">
        <h2 id="llm-h" className="font-display text-xl">AI-assisted reading</h2>
        <p className="text-muted">{llm.label}. Only for patients who consented. Every result still needs its exact quote and a person to check it.</p>
        <KeyValue items={[
          ...(usage ? [{ label: 'Shared key', value: `${usage.today} of ${usage.limits.rpd} calls used today (all organisations)` }] : []),
          { label: 'Calls', value: `${n(orgUse.calls)} of ${n(st.llmBudget.calls)} used today` },
        ]} />
      </section>
      <p className="text-[15px] text-muted"><a className="underline underline-offset-4" href="/security">Security & compliance</a>: what is built for India&apos;s DPDP Act and ABDM, what follows HIPAA&apos;s safeguards, and what is planned.</p>
      <SettingsForm
        flags={{ voice: st.flags.voice, tts: st.flags.tts, ai_extraction: st.flags.ai_extraction, voice_shadow: !!st.flags.voice_shadow }}
        questions={questionSettings(st.flags.questions).map((q) => ({ ...q, label: en[`q_${q.id}`] }))}
        retentionDays={st.retentionDays} minRetentionDays={MIN_RETENTION_DAYS} demo={st.demo} demoOffsetDays={Math.round(st.demoClockOffsetS / DAY_S)}
        llmBudget={st.llmBudget} llmBudgetMax={LLM_BUDGET_MAX} />
    </div>
  )
}
