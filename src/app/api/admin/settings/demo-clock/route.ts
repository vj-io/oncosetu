import { z } from 'zod'
import { route } from '@/server/http'
import { setDemoClock } from '@/server/admin/ops'

// DEMO_MODE only (404 otherwise): drives request reminders at +7 / +21 days (V04-E2E-02).
export const POST = route({
  auth: 'staff', roles: ['org_admin'], body: z.object({ preset: z.enum(['plus7', 'plus21', 'reset']) }),
}, (ctx) => setDemoClock(ctx, ctx.body.preset))
