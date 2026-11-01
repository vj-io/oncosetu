import type { ReactNode } from 'react'
import { StaffShell } from '@/components/shell'
import { requireStaff } from '@/server/session'
import { isDemo } from '@/server/demo'

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const s = await requireStaff()
  return (
    <StaffShell user={{ name: s.staffName, role: s.role, orgName: s.orgName }} demo={isDemo()}>
      {children}
    </StaffShell>
  )
}
