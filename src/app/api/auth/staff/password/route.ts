// A staff member changes their own password (src/server/own-password.ts). A refusal is returned, not thrown, so the request's
// transaction commits and the audit row of a wrong guess is kept.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/server/http'
import { changeOwnPassword } from '@/server/own-password'

export const POST = route({ auth: 'staff', body: z.object({ current: z.string().max(200), next: z.string().max(200) }) }, async (ctx) => {
  const r = await changeOwnPassword(ctx.session, ctx.body.current, ctx.body.next)
  if (!r.ok) {
    if (r.audit) await ctx.audit(r.audit.action, 'staff', ctx.session.staffId, r.audit.details)
    return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status })
  }
  await ctx.audit('auth.password_changed', 'staff', ctx.session.staffId, { ended: r.ended })
  return { ok: true, ended: r.ended }
})
