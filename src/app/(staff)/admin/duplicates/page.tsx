import { SectionHeader } from '@/components/ui'
import { DuplicatesPanel } from '@/components/admin/DuplicatesPanel'
import { withOrg } from '@/db'
import { listDuplicates, listMerges } from '@/server/admin/duplicates'
import { istDate } from '@/server/admin/format'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Duplicates · Admin · OncoSetu' }

export default async function DuplicatesPage() {
  const s = await requireStaff(sectionRoles('duplicates'))
  const { merges, candidates } = await withOrg(s.orgId, async (tx) => {
    const merges = await listMerges(tx, s.orgId)
    return { merges, candidates: await listDuplicates(tx, s.orgId, merges) }
  })
  const view = (v: (typeof candidates)[number]['a']) => ({ id: v.id, accession: v.accession, initials: v.initials, mrn: v.mrn, created: istDate(v.createdAt), documents: v.documents, events: v.events })
  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker="Admin · Identity" title="Duplicate patients"
        description="A merge needs two different staff members: one requests it, another approves. Both approvals are written to the audit log." />
      <DuplicatesPanel meId={s.staffId}
        candidates={candidates.map((c) => ({ key: `${c.a.id}|${c.b.id}`, reasons: c.reasons, confidence: c.confidence, a: view(c.a), b: view(c.b), suggestedSurvivor: c.suggestedSurvivor }))}
        merges={merges.map((m) => ({ id: m.id, state: m.state, survivor: m.survivor, duplicate: m.duplicate, requestedBy: m.requestedBy, requestedById: m.requestedById, approvedBy: m.approvedBy, reason: m.reason, created: istDate(m.createdAt), executed: m.executedAt ? istDate(m.executedAt) : null }))} />
    </div>
  )
}
