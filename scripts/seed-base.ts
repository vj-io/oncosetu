// Idempotent base seed: two fictional orgs, demo staff (password Demo@2026, deterministic TOTP secrets),
// org_settings. No patients (seeded elsewhere). rule_states left empty → every rule runs in shadow mode.
//   npx tsx --env-file=.env.local scripts/seed-base.ts
import { adminDb, closeDb } from '../src/db'
import { organisations, orgSettings, staff } from '../src/db/schema'
import { base32Encode, encryptField, hashPassword, sha256Hex } from '../src/server/crypto'
import { DEMO_PASSWORD, ORG_GANGA_ID, ORG_NARMADA_ID } from '../src/server/demo'

const ORGS = [
  { id: ORG_NARMADA_ID, slug: 'narmada', name: 'Narmada Regional Cancer Centre', isDemo: true },
  { id: ORG_GANGA_ID, slug: 'ganga', name: 'Ganga Valley Hospital', isDemo: false },
]

const STAFF = [
  { orgId: ORG_NARMADA_ID, role: 'desk', email: 'desk@narmada.demo', name: 'Asha Pawar' },
  { orgId: ORG_NARMADA_ID, role: 'records', email: 'records@narmada.demo', name: 'Ravi Kulkarni' },
  { orgId: ORG_NARMADA_ID, role: 'clinician', email: 'clinician@narmada.demo', name: 'Dr. Meera Iyer' },
  { orgId: ORG_NARMADA_ID, role: 'org_admin', email: 'admin@narmada.demo', name: 'Farhan Sheikh' },
  { orgId: ORG_NARMADA_ID, role: 'auditor', email: 'auditor@narmada.demo', name: 'Neha Joshi' },
  { orgId: ORG_GANGA_ID, role: 'clinician', email: 'clinician@ganga.demo', name: 'Dr. Arjun Mehta' },
] as const

/** Isolated E2E staff (Ganga only, is_demo=false so the public demo-accounts list stays clean). Password: env E2E_PASSWORD. */
const E2E_STAFF = [
  { orgId: ORG_GANGA_ID, role: 'desk', email: 'desk@ganga.test', name: 'E2E Desk' },
  { orgId: ORG_GANGA_ID, role: 'records', email: 'records@ganga.test', name: 'E2E Records' },
  { orgId: ORG_GANGA_ID, role: 'clinician', email: 'clinician@ganga.test', name: 'Dr. E2E Clinician' },
  { orgId: ORG_GANGA_ID, role: 'org_admin', email: 'admin@ganga.test', name: 'E2E Admin' },
] as const

/** Known demo TOTP secret: base32(first 20 bytes of sha256("oncosetu-demo-totp:" + email)). */
export const demoTotpSecret = (email: string) =>
  base32Encode(Buffer.from(sha256Hex(`oncosetu-demo-totp:${email}`), 'hex').subarray(0, 20))

async function main() {
  for (const o of ORGS) {
    await adminDb.insert(organisations).values(o)
      .onConflictDoUpdate({ target: organisations.id, set: { slug: o.slug, name: o.name, isDemo: o.isDemo } })
    await adminDb.insert(orgSettings).values({ orgId: o.id }).onConflictDoNothing()
  }
  for (const s of STAFF) {
    const passwordHash = await hashPassword(DEMO_PASSWORD)
    const totpSecretEnc = encryptField(demoTotpSecret(s.email))
    await adminDb.insert(staff).values({ ...s, passwordHash, totpSecretEnc, isDemo: true, active: true })
      .onConflictDoUpdate({
        target: staff.email,
        set: { orgId: s.orgId, role: s.role, name: s.name, passwordHash, totpSecretEnc, isDemo: true, active: true, failedLogins: 0, lockedUntil: null },
      })
  }
  const e2ePasswordHash = await hashPassword(process.env.E2E_PASSWORD ?? DEMO_PASSWORD)
  for (const s of E2E_STAFF) {
    const totpSecretEnc = encryptField(demoTotpSecret(s.email))
    await adminDb.insert(staff).values({ ...s, passwordHash: e2ePasswordHash, totpSecretEnc, isDemo: false, active: true })
      .onConflictDoUpdate({
        target: staff.email,
        set: { orgId: s.orgId, role: s.role, name: s.name, passwordHash: e2ePasswordHash, totpSecretEnc, isDemo: false, active: true, failedLogins: 0, lockedUntil: null },
      })
  }
  console.log(`seeded ${ORGS.length} orgs, ${STAFF.length} demo staff, ${E2E_STAFF.length} e2e staff`)
}

main().then(closeDb).catch(async (e) => { console.error(e); await closeDb(); process.exit(1) })
