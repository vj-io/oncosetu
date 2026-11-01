export const isDemo = (): boolean => process.env.DEMO_MODE === 'true'

/** Fixed ids from scripts/seed-base.ts so other seeds/tests can reference the fictional orgs. */
export const ORG_NARMADA_ID = '0193a000-0000-7000-8000-000000000001' // demo org
export const ORG_GANGA_ID = '0193a000-0000-7000-8000-000000000002' // second org (cross-org tests)
export const DEMO_PASSWORD = 'Demo@2026'
