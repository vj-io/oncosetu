// Front-desk identification (FR-ID-02): a scan or lookup identifies only; the record opens after an OTP to the
// primary contact or an in-person witnessed consent event. Every step is audited.
import { desc, eq, gte, inArray } from 'drizzle-orm'
import type { Tx } from '@/db'
import { encounters, patients, staff } from '@/db/schema'
import { istDate } from '@/core/copy'
import { now } from '../clock'
import { activeConsent, initials } from '../patients'
import { decryptField } from '../crypto'
import { checkOtp, deskPurpose, otpFailure, sendOtpTo } from './confirm'
import { primaryContactTarget } from './contact'
import { insertConsent } from './consent'
import { accession, fail, type AuditFn, type StaffCtx } from './http'

const REUSE_WINDOW_MS = 12 * 3_600_000

/** Starts the visit's encounter: onboarding for a first visit, returning otherwise. An open one from today is reused. */
export async function openEncounter(tx: Tx, audit: AuditFn, p: { orgId: string; patientId: string; staffId: string }): Promise<{ id: string; type: 'onboarding' | 'returning' | 'between'; reused: boolean }> {
  const prior = await tx.select({ id: encounters.id, type: encounters.type, startedAt: encounters.startedAt, closedAt: encounters.closedAt })
    .from(encounters).where(eq(encounters.patientId, p.patientId)).orderBy(desc(encounters.startedAt))
  const open = prior[0]
  if (open && !open.closedAt && Date.now() - open.startedAt.getTime() < REUSE_WINDOW_MS) return { id: open.id, type: open.type, reused: true }
  const type = prior.length ? 'returning' : 'onboarding'
  const [enc] = await tx.insert(encounters).values({ orgId: p.orgId, patientId: p.patientId, type, startedBy: p.staffId }).returning({ id: encounters.id })
  await audit('encounter.started', 'encounter', enc.id, { patientId: p.patientId, type })
  return { id: enc.id, type, reused: false }
}

async function activePatient(tx: Tx, patientId: string) {
  const [p] = await tx.select({ id: patients.id, deceased: patients.deceased, status: patients.status }).from(patients).where(eq(patients.id, patientId))
  return p && p.status === 'active' ? p : null
}

/** "Send code" → simulated SMS to the primary contact (the caregiver when the caregiver is primary). */
export async function deskSendCode(ctx: StaffCtx<{ patientId: string }>) {
  const { session: s, body, db: tx } = ctx
  if (!(await activePatient(tx, body.patientId))) return fail(404, 'not_found', 'Not found')
  const sent = await sendOtpTo(tx, {
    orgId: s.orgId, patientId: body.patientId, target: await primaryContactTarget(tx, body.patientId),
    purpose: deskPurpose(body.patientId), templateKey: 'desk.otp',
  })
  await ctx.audit('desk.otp_requested', 'patient', body.patientId, { outcome: sent })
  if (sent === 'no_phone') return fail(409, 'no_phone', 'No phone number is on file. Use in-person witnessed consent.')
  if (sent === 'locked') return fail(429, 'locked', 'Too many codes for this phone (or wrong codes). Try again later, or use in-person witnessed consent.')
  return { ok: true }
}

/** Code entered → opens the encounter. Failures are returned (not thrown) so the audit row of the attempt is kept. */
export async function deskVerifyCode(ctx: StaffCtx<{ patientId: string; code: string }>) {
  const { session: s, body, db: tx } = ctx
  const p = await activePatient(tx, body.patientId)
  if (!p) return fail(404, 'not_found', 'Not found')
  const r = await checkOtp(await primaryContactTarget(tx, body.patientId), deskPurpose(body.patientId), body.code)
  if (r !== 'ok') {
    await ctx.audit('desk.verify_failed', 'patient', body.patientId, { reason: r })
    return otpFailure(r)!
  }
  const enc = await openEncounter(tx, ctx.audit, { orgId: s.orgId, patientId: body.patientId, staffId: s.staffId })
  const consentActive = !!(await activeConsent(tx, body.patientId))
  await ctx.audit('desk.verified', 'patient', body.patientId, { method: 'otp', encounterId: enc.id, consentActive })
  return { ok: true, encounterId: enc.id, encounterType: enc.type, consentActive, patientUrl: `/patients/${body.patientId}/overview` }
}

/**
 * In-person alternative: staff witness the patient (or caregiver) and record a consent event that re-affirms the
 * current consent. With no active consent (withdrawn) nothing is re-affirmed: the encounter opens and the caller is
 * told to record new consent (`consentActive: false`).
 */
export async function deskVerifyWitnessed(ctx: StaffCtx<{ patientId: string; attest: true }>) {
  const { session: s, body, db: tx } = ctx
  if (!(await activePatient(tx, body.patientId))) return fail(404, 'not_found', 'Not found')
  const current = await activeConsent(tx, body.patientId)
  const consentId = current
    ? await insertConsent(tx, {
      orgId: s.orgId, patientId: body.patientId, action: 'update', purposes: current.purposes, actorType: 'staff', actorId: s.staffId,
      method: 'desk_assisted', witnessedBy: s.staffId, noticeVersion: current.noticeVersion, language: current.language,
    })
    : null
  const enc = await openEncounter(tx, ctx.audit, { orgId: s.orgId, patientId: body.patientId, staffId: s.staffId })
  await ctx.audit('desk.verified', 'patient', body.patientId, { method: 'witnessed', consentId, encounterId: enc.id, consentActive: !!current })
  return { ok: true, encounterId: enc.id, encounterType: enc.type, consentActive: !!current, patientUrl: `/patients/${body.patientId}/overview` }
}

export type TodayEncounter = { id: string; patientId: string; initials: string; accession: string; type: string; startedAt: Date; startedBy: string; open: boolean }

/** Encounters started today (IST, on the org's business clock). Initials only. */
export async function todaysEncounters(tx: Tx, orgId: string): Promise<TodayEncounter[]> {
  const since = new Date(`${istDate((await now(orgId)).toISOString())}T00:00:00+05:30`)
  const rows = await tx.select({ e: encounters, nameEnc: patients.nameEnc }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId)).where(gte(encounters.startedAt, since)).orderBy(desc(encounters.startedAt))
  const starters = [...new Set(rows.map((r) => r.e.startedBy).filter((x): x is string => !!x))]
  const names = starters.length ? await tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, starters)) : []
  const nameOf = new Map(names.map((n) => [n.id, n.name]))
  return rows.map(({ e, nameEnc }) => ({
    id: e.id, patientId: e.patientId, initials: initials(decryptField(nameEnc)), accession: accession(e.patientId), type: e.type,
    startedAt: e.startedAt, startedBy: (e.startedBy && nameOf.get(e.startedBy)) || '—', open: !e.closedAt,
  }))
}
