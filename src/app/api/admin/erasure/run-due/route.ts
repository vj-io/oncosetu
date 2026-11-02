// J8 / PRD §10.5: the retention job for this org, run by hand. The cron (/api/cron/erasure) runs the same for every org.
import { runDueErasures } from '@/server/erasure/erasure'
import { route } from '@/server/http'

export const POST = route({ auth: 'staff', roles: ['org_admin'] }, async (ctx) => ({ ok: true, ...(await runDueErasures(ctx)) }))
