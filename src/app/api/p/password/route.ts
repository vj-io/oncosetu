// The signed-in patient or caregiver chooses (or replaces) the password for signing in from home.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/server/http'
import { PASSWORD_MAX, passwordProblem, passwordState, setPassword } from '@/server/portal/password'

const MESSAGES = {
  too_short: 'Use at least 8 characters.',
  too_long: 'Use at most 128 characters.',
  is_phone: 'Do not use your mobile number as the password.',
  too_simple: 'This password is too easy to guess. Try a few words together.',
} as const

export const POST = route({ auth: 'patient', body: z.object({ password: z.string().max(PASSWORD_MAX + 1) }) }, async ({ session, db, body, audit }) => {
  const who = { kind: session.kind, patientId: session.patientId, caregiverId: session.caregiverId }
  const problem = passwordProblem(body.password, (await passwordState(db, who)).phone)
  if (problem) return NextResponse.json({ error: { code: problem, message: MESSAGES[problem] } }, { status: 400 })
  const r = await setPassword(db, { ...who, sessionId: session.sessionId }, body.password)
  await audit('auth.portal_password_set', 'patient', session.patientId, { first: r.first, endedSessions: r.endedSessions })
  return { ok: true }
})
