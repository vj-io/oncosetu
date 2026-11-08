// Sign out everywhere else (ASVS 3.3.3): ends every live session of this staff member except the current one. Audited.
import { route } from '@/server/http'
import { revokeOtherSessions } from '@/server/own-sessions'

export const POST = route({ auth: 'staff' }, async (ctx) => {
  const ended = await revokeOtherSessions(ctx.session)
  await ctx.audit('auth.sessions_revoked', 'staff', ctx.session.staffId, { ended })
  return { ended }
})
