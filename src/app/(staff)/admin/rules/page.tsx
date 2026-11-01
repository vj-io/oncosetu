import { CircleAlert, ShieldCheck } from 'lucide-react'
import { Badge, KeyValue, SectionHeader, StatusBadge } from '@/components/ui'
import { RuleActions } from '@/components/admin/RuleActions'
import { withOrg } from '@/db'
import { istDateTime } from '@/server/admin/format'
import { listReviewers, listRules } from '@/server/admin/rules'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Rule library · Admin · OncoSetu' }

export default async function RulesPage() {
  const s = await requireStaff(sectionRoles('rules'))
  const { rules, reviewers } = await withOrg(s.orgId, async (tx) => ({ rules: await listRules(tx, s.orgId), reviewers: await listReviewers(tx, s.orgId) }))
  const prod = rules.filter((r) => r.mode === 'production').length
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Missing-Record Radar" title="Rule library"
        description={`${rules.length} rules. ${prod} in production, ${rules.length - prod} in shadow: shadow rules run and log hits but nothing is shown to staff (FR-RAD-05).`} />
      <p className="flex max-w-3xl items-start gap-3 border border-l-[3px] border-rule border-l-setu bg-setu-tint px-4 py-3 text-[15px]">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-setu-ink" />
        <span><strong className="font-medium">ADR-002.</strong> Rule wording is document completeness only: whether a document is in the file, never what care a patient needs. Promoting a rule records the reviewing clinician and the time.</span>
      </p>
      <ul className="grid gap-5">
        {rules.map((r) => {
          const t = r.rule.trigger, e = r.rule.expects
          return (
            <li key={r.rule.id} className="grid gap-4 border border-rule bg-surface px-5 py-5 shadow-placard sm:px-6">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <p className="font-mono text-base tracking-[0.06em]">{r.rule.id} <span className="text-faint">· v{r.rule.version}</span></p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.mode === 'production' ? <Badge tone="verified" icon={<ShieldCheck />}>Production</Badge> : <StatusBadge status="shadow_mode" />}
                    {r.wordingHits === 0 ? <Badge tone="neutral">Copy lint clean</Badge> : <Badge tone="conflict" icon={<CircleAlert />}>{r.wordingHits} banned term{r.wordingHits === 1 ? '' : 's'} in wording</Badge>}
                  </div>
                </div>
                <RuleActions ruleId={r.rule.id} mode={r.mode} reviewers={reviewers} />
              </header>
              <KeyValue items={[
                { label: 'Trigger', value: <>{t.event_type.replace(/_/g, ' ')}{t.required_fields.length > 0 && <span className="text-muted"> · needs {t.required_fields.join(', ')}</span>}</> },
                { label: 'Expects', value: <>{e.document_types.map((d) => d.replace(/_/g, ' ')).join(' or ')}{e.document_types_from_test && <span className="text-muted"> (type follows the named test)</span>}</> },
                { label: 'Window', value: <span className="font-mono text-sm">{e.window_days[0]} to {e.window_days[1]} days from the trigger date</span> },
                { label: 'EN', value: r.rule.wording.en },
                { label: 'HI', value: <span lang="hi" className="font-deva">{r.rule.wording.hi}</span> },
                { label: 'Review', value: r.mode === 'production' && r.reviewedBy ? `Reviewed by ${r.reviewedBy} on ${istDateTime(r.reviewedAt)}` : r.reviewedBy ? `Last reviewed by ${r.reviewedBy} on ${istDateTime(r.reviewedAt)}; now back in shadow` : 'Not clinician-reviewed' },
              ]} />
              <footer className="flex flex-wrap gap-x-8 gap-y-1 border-t border-rule pt-3 font-mono text-sm tabular-nums">
                <span>Shadow hits <strong className="font-medium">{r.shadowHits}</strong></span>
                <span>Production items <strong className="font-medium">{r.productionItems}</strong></span>
              </footer>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
