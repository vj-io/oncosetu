import { SectionHeader } from '@/components/ui'
import { StaffManager } from '@/components/admin/StaffManager'
import { withOrg } from '@/db'
import { istDateTime } from '@/server/admin/format'
import { sectionRoles } from '@/server/admin/sections'
import { listStaff } from '@/server/admin/staff'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Staff · Admin · OncoSetu' }

export default async function StaffPage() {
  const s = await requireStaff(sectionRoles('staff'))
  const rows = await withOrg(s.orgId, (tx) => listStaff(tx, s.orgId))
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Staff" title="Staff and roles" description="Create accounts, change roles, deactivate leavers and reset authenticators. The organisation always keeps at least one active administrator." />
      <StaffManager meId={s.staffId} rows={rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, active: r.active, totpEnabled: r.totpEnabled, locked: r.locked, isDemo: r.isDemo, lastLogin: r.lastLoginAt ? istDateTime(r.lastLoginAt) : null }))} />
    </div>
  )
}
