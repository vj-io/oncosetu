// Your sign-ins (ASVS 3.3.4): this staff member's live sessions, newest activity first. No tokens, ids only.
import { route } from '@/server/http'
import { listOwnSessions } from '@/server/own-sessions'

export const GET = route({ auth: 'staff' }, async (ctx) => ({ sessions: await listOwnSessions(ctx.session) }))
