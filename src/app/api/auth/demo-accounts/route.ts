import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organisations, staff } from '@/db/schema'
import { decryptField } from '@/server/crypto'
import { DEMO_PASSWORD, isDemo } from '@/server/demo'
import { HttpError, route } from '@/server/http'
import { totp, totpSecondsRemaining } from '@/server/totp'

// DEMO_MODE only: seeded demo staff with their password and CURRENT TOTP code.
export const GET = route({ auth: 'public' }, async () => {
  if (!isDemo()) throw new HttpError(404, 'not_found', 'Not found')
  const rows = await db.select({ staff, orgName: organisations.name }).from(staff)
    .innerJoin(organisations, eq(organisations.id, staff.orgId))
    .where(eq(staff.isDemo, true)).orderBy(asc(organisations.name), asc(staff.role))
  const t = Date.now()
  return {
    expiresInS: totpSecondsRemaining(t),
    accounts: rows.filter((r) => r.staff.active && r.staff.totpSecretEnc).map((r) => ({
      email: r.staff.email, name: r.staff.name, role: r.staff.role, orgName: r.orgName, password: DEMO_PASSWORD,
      totp: totp(decryptField(r.staff.totpSecretEnc!), t),
    })),
  }
})
