// PRD §10.2 "RBAC matrix test: every role × every endpoint" against the running server: every handler in
// src/app/api/**/route.ts is called as each signed-in role and anonymously, and the answer must match
// tests/security/api-roles.ts in both directions — an allowed role is never stopped by a role check, every other role is.
// tests/security/rbac-endpoints.test.ts proves the table covers every handler; this proves the table matches behaviour.
//
// Nothing is changed by the sweep: ids in paths are random UUIDs (404 after the role check), JSON bodies are invalid
// (400 after the role check) except for the few handlers that narrow roles inside, which get a valid body aimed at a
// random id. Three handlers whose allowed call would act on real data are only called by roles that must be refused.
import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { EXPECTED, policyOf } from '../security/api-roles'
import { SIGNED_IN_ROLES, scanApiRoutes, type ScannedRoute, type SignedInRole } from '../security/api-routes'
import { Api, anonymous, portalLogin, registerPatient } from './helpers/api'
import { test, expect } from './helpers/fixtures'

/** Allowed calls with a real effect even on random input (erasure sweep, own-record erasure request, sign-out). */
const NOT_CALLED_AS_ALLOWED = new Set(['POST /api/admin/erasure/run-due', 'POST /api/p/erasure', 'POST /api/auth/logout'])
/** Handlers that narrow roles after parsing the body need a body that parses (aimed at a random id), or every role gets 400. */
const VALID_BODY: Record<string, unknown> = {
  'POST /api/requests': { patientId: randomUUID(), institution: 'RBAC sweep hospital' },
  'POST /api/requests/[id]/sent': {},
  'POST /api/requests/[id]/unobtainable': { reason: 'RBAC sweep' },
}

async function call(ctx: APIRequestContext, r: ScannedRoute): Promise<{ status: number; code: string | undefined }> {
  const url = r.path.replace(/\[[^\]]+\]/g, () => randomUUID())
  const body = VALID_BODY[r.key]
  const res = await ctx.fetch(url, {
    method: r.method,
    ...(body !== undefined ? { data: body }
      : r.form ? { multipart: { probe: '1' } }
        : r.body ? { data: '"not an object"', headers: { 'content-type': 'application/json' } } : {}),
    maxRedirects: 0,
  })
  const text = await res.text()
  let code: string | undefined
  try { code = JSON.parse(text)?.error?.code } catch { /* not JSON */ }
  return { status: res.status(), code }
}

test('RBAC sweep: every API handler × every role answers as tests/security/api-roles.ts says', async ({ staff }) => {
  test.setTimeout(600_000)
  const records = await staff('records')
  const p = await registerPatient(records, { withCaregiver: true, primaryContact: 'patient' })
  const clients: Record<SignedInRole, APIRequestContext> = {
    desk: (await staff('desk')).ctx, records: records.ctx, clinician: (await staff('clinician')).ctx, org_admin: (await staff('admin')).ctx,
    // Ganga has no auditor; the role check runs before any org data is touched, so the Narmada auditor stands in.
    auditor: (await Api.login({ email: 'auditor@narmada.demo' })).ctx,
    patient: (await portalLogin(p.phone!)).ctx,
    caregiver: (await portalLogin(p.caregiverPhone!)).ctx,
  }
  for (const [role, ctx] of Object.entries(clients)) {
    const me = await (await ctx.get('/api/auth/me')).json()
    expect(me.session.kind === 'staff' ? me.session.role : me.session.kind, `session for ${role}`).toBe(role)
  }
  const anon = await anonymous()

  const routes = scanApiRoutes()
  const wrong: string[] = []
  let calls = 0
  const expectFor = async (who: SignedInRole | 'anonymous', ctx: APIRequestContext, r: ScannedRoute) => {
    const e = EXPECTED[r.key]
    const policy = policyOf(e)
    const allowed = who !== 'anonymous' && policy !== 'public' && policy.includes(who)
    if (allowed && NOT_CALLED_AS_ALLOWED.has(r.key)) return
    const got = await call(ctx, r)
    calls++
    const roleStop = got.status === 401 || (got.status === 403 && got.code === 'forbidden')
    if (policy === 'public') {
      // Machine callers (cron, webhooks) refuse anyone without their secret or signature, a staff session included:
      // 401/403, 404 for a probe that is switched off, 503 when the secret is not configured.
      if (![401, 403, 404, 503].includes(got.status)) wrong.push(`${r.key} ${who}: ${got.status} ${got.code ?? ''} (accepted without the secret)`)
    } else if (who === 'anonymous') {
      if (got.status !== 401) wrong.push(`${r.key} anonymous: ${got.status} ${got.code ?? ''}`)
    } else if (allowed === roleStop) {
      wrong.push(`${r.key} ${who}: ${got.status} ${got.code ?? ''} (${allowed ? 'allowed but refused' : 'should be refused'})`)
    }
  }

  await Promise.all([
    ...SIGNED_IN_ROLES.map(async (role) => {
      for (const r of routes) if (EXPECTED[r.key] !== 'public') await expectFor(role, clients[role], r)
    }),
    (async () => { for (const r of routes) if (EXPECTED[r.key] !== 'public') await expectFor('anonymous', anon, r) })(),
  ])
  await anon.dispose()
  for (const role of ['auditor', 'patient', 'caregiver'] as const) await clients[role].dispose()

  expect(wrong).toEqual([])
  expect(calls).toBeGreaterThan(routes.length * 6) // the sweep really ran
})
