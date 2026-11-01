import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organisations, staff } from '@/db/schema'
import { decryptField } from '@/server/crypto'
import { DEMO_PASSWORD, ORG_NARMADA_ID, isDemo } from '@/server/demo'
import { HttpError, route } from '@/server/http'
import { totp, totpSecondsRemaining } from '@/server/totp'

// DEMO_MODE only: the demo org's seeded staff with their password and CURRENT TOTP code (the second org exists for isolation tests).
export const GET = route({ auth: 'public' }, async () => {
  if (!isDemo()) throw new HttpError(404, 'not_found', 'Not found')
  const rows = await db.select({ staff, orgName: organisations.name }).from(staff)
    .innerJoin(organisations, eq(organisations.id, staff.orgId))
    .where(and(eq(staff.isDemo, true), eq(staff.orgId, ORG_NARMADA_ID))).orderBy(asc(organisations.name), asc(staff.role))
  const t = Date.now()
  return {
    expiresInS: totpSecondsRemaining(t),
    accounts: rows.filter((r) => r.staff.active && r.staff.totpSecretEnc).map((r) => ({
      email: r.staff.email, name: r.staff.name, role: r.staff.role, orgName: r.orgName, password: DEMO_PASSWORD,
      totp: totp(decryptField(r.staff.totpSecretEnc!), t),
    })),
  }
})
