import type { ReactNode } from 'react'
import { AdminNav } from '@/components/admin/AdminNav'
import { SECTIONS } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

// Desk (and anyone signed out) never reaches a section: 403 / login here. Each page narrows the roles further.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const s = await requireStaff(['org_admin', 'auditor', 'clinician', 'records'])
  const items = Object.values(SECTIONS).filter((x) => (x.roles as readonly string[]).includes(s.role)).map(({ href, label }) => ({ href, label }))
  return (
    <div className="grid grid-cols-1 gap-8">
      <AdminNav items={items} />
      {children}
    </div>
  )
}
