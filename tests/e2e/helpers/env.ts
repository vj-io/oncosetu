// Shared E2E environment: BASE_URL, the isolated Ganga org, and the DB env (.env.local) for fixtures that read or nudge the database.
import { existsSync } from 'node:fs'
import { ORG_GANGA_ID } from '../../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

export const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
export const PASSWORD = process.env.E2E_PASSWORD ?? 'Demo@2026'
/** Every test runs in this organisation; the Narmada org holds the live demo data. */
export const ORG = ORG_GANGA_ID

export type RoleKey = 'desk' | 'records' | 'clinician' | 'admin'
export const EMAIL: Record<RoleKey, string> = {
  desk: 'desk@ganga.test', records: 'records@ganga.test', clinician: 'clinician@ganga.test', admin: 'admin@ganga.test',
}
/** Narmada staff, only used to prove cross-org isolation. */
export const NARMADA_RECORDS = 'records@narmada.demo'
