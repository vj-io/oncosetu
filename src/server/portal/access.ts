// "Who looked at my file" (FR-CON-05, FR-PAS-04): staff audit rows for this patient and share-link views, as plain sentences.
// The organisation's name is never shown unless disclosure is cleared (a hospital name can itself be a diagnosis word).
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Lang } from '@/core/types'
import type { Tx } from '@/db'
import { auditLog, caregivers, documents, events, shareViews } from '@/db/schema'
import { tp, type PatientKey } from '@/i18n/patient'
import { decryptField } from '../crypto'
import { formatDateTimeIN } from './summary'

export type AccessEntry = { id: string; at: string; text: string }

const STAFF_ROLES = ['desk', 'records', 'clinician', 'org_admin', 'auditor']

/** Coarse device word from a user-agent string. Nothing else about the agent is kept. */
export function deviceOf(ua: string | null | undefined): 'phone' | 'tablet' | 'computer' | 'unknown' {
  const s = ua ?? ''
  if (/iPad|Tablet/i.test(s)) return 'tablet'
  if (/Mobi|Android|iPhone/i.test(s)) return 'phone'
  if (/Windows|Macintosh|Linux|X11|CrOS/i.test(s)) return 'computer'
  return 'unknown'
}

/** Which sentence an audit row becomes. Names the kind of action only; never the details. */
export function classifyAction(action: string, targetType: string | null): 'emergency' | 'exported' | 'viewed_document' | 'viewed' | 'other' {
  if (/break_glass/.test(action)) return 'emergency'
  if (/export|download|print|passport/.test(action)) return 'exported'
  if (/view|read|open|lookup|source/.test(action)) return targetType === 'document' || /document|source/.test(action) ? 'viewed_document' : 'viewed'
  return 'other'
}

const ROLE_KEYS = {
  desk: 'role_desk', records: 'role_records', clinician: 'role_clinician', org_admin: 'role_org_admin', auditor: 'role_auditor',
} as const satisfies Record<string, PatientKey>

/** "Clinic staff (Records)". The query keeps only staff roles, so an unknown role cannot reach here. */
export function staffWho(role: string, lang: Lang): string {
  return tp(lang, 'who_clinic', { role: tp(lang, ROLE_KEYS[role as keyof typeof ROLE_KEYS] ?? 'role_desk') })
}

export async function loadAccessLog(tx: Tx, patientId: string, lang: Lang, viewerIsPatient: boolean): Promise<AccessEntry[]> {
  const mine = sql`${auditLog.targetId} in (select ${documents.id}::text from ${documents} where ${documents.patientId} = ${patientId})`
  const evs = sql`${auditLog.targetId} in (select ${events.id}::text from ${events} where ${events.patientId} = ${patientId})`
  const rows = await tx.select({
    id: auditLog.id, at: auditLog.at, role: auditLog.actorRole, action: auditLog.action, targetType: auditLog.targetType,
  }).from(auditLog).where(and(
    inArray(auditLog.actorRole, STAFF_ROLES),
    or(
      and(eq(auditLog.targetType, 'patient'), eq(auditLog.targetId, patientId)),
      and(eq(auditLog.targetType, 'document'), mine),
      and(eq(auditLog.targetType, 'event'), evs),
      sql`${auditLog.details}->>'patientId' = ${patientId}`,
    ),
  )).orderBy(desc(auditLog.seq)).limit(300)

  const out: (AccessEntry & { key: string })[] = []
  for (const r of rows) {
    const kind = classifyAction(r.action, r.targetType)
    const key = tp(lang, `acc_${kind}` as PatientKey, { who: staffWho(r.role, lang) })
    out.push({ id: r.id, at: r.at.toISOString(), text: key, key: `${r.role}|${kind}|${r.at.toISOString().slice(0, 16)}` })
  }

  const views = await tx.select({ id: shareViews.id, at: shareViews.at, outcome: shareViews.outcome, ua: shareViews.userAgent })
    .from(shareViews).where(eq(shareViews.patientId, patientId)).orderBy(desc(shareViews.at)).limit(100)
  for (const v of views) {
    const k = `acc_share_${['viewed', 'wrong_passcode', 'locked', 'expired', 'revoked'].includes(v.outcome) ? v.outcome : 'viewed'}` as PatientKey
    out.push({ id: v.id, at: v.at.toISOString(), text: `${tp(lang, k)} ${tp(lang, `dev_${deviceOf(v.ua)}` as PatientKey)}`, key: v.id })
  }

  if (viewerIsPatient) {
    const cgs = await tx.select({ id: caregivers.id, nameEnc: caregivers.nameEnc }).from(caregivers).where(eq(caregivers.patientId, patientId))
    if (cgs.length) {
      const names = new Map(cgs.map((c) => [c.id, decryptField(c.nameEnc)]))
      const logins = await tx.select({ id: auditLog.id, at: auditLog.at, actorId: auditLog.actorId }).from(auditLog)
        .where(and(eq(auditLog.action, 'auth.patient_login'), eq(auditLog.actorRole, 'caregiver'), inArray(auditLog.actorId, [...names.keys()])))
        .orderBy(desc(auditLog.seq)).limit(50)
      for (const l of logins) {
        out.push({ id: l.id, at: l.at.toISOString(), text: tp(lang, 'acc_caregiver_login', { name: names.get(l.actorId ?? '') ?? '' }), key: l.id })
      }
    }
  }

  out.sort((a, b) => b.at.localeCompare(a.at))
  // Collapse repeats by the same role and kind within one minute (page reloads) into one line.
  const seen = new Set<string>()
  return out.filter((e) => (seen.has(e.key) ? false : seen.add(e.key))).slice(0, 100)
    .map((e) => ({ id: e.id, at: formatDateTimeIN(e.at, lang), text: e.text }))
}
