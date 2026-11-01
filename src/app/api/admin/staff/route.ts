import { z } from 'zod'
import { route } from '@/server/http'
import { createStaff } from '@/server/admin/staff'
import { zRole } from '@/server/admin/schemas'

// FR-ADM-01. The TOTP secret + QR are returned once, in this response only.
export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().max(254).pipe(z.email()), role: zRole, password: z.string().min(12).max(200) }),
}, (ctx) => createStaff(ctx, ctx.body))
