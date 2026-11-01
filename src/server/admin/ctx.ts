import type { Tx } from '@/db'
import type { AuditDetails } from '../audit'
import type { StaffSession } from '../session'

/** The slice of the route() context that admin mutations need. Every mutation calls ctx.audit with ids only. */
export type AdminCtx = {
  db: Tx
  session: StaffSession
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}
