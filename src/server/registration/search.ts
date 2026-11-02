// Patient lookup for staff: by phone, MRN, accession code or name. Names are encrypted, so name search decrypts in the app.
import { and, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { patientAliases, patients } from '@/db/schema'
import { normaliseName } from '@/core/identity'
import { decryptField, maskPhone, normalizePhone, phoneHmac } from '../crypto'
import { ageYears, initials } from '../patients'
import { accession } from './http'

export type PatientRow = {
  id: string; accession: string; name: string; initials: string; ageYears: number | null
  sex: 'female' | 'male' | 'other' | 'unknown'; mrn: string | null; disclosure: 'cleared' | 'not_cleared' | 'unknown'
  minor: boolean; deceased: boolean; hasConsent: boolean; createdAt: Date; phoneMasked: string | null
}

/** What the desk may see before the person is verified (FR-ID-02): initials and a non-identifying code. */
export const initialsView = (r: Pick<PatientRow, 'id' | 'initials' | 'accession'>) => ({ id: r.id, initials: r.initials, accession: r.accession })

/** The row as staff may see it: without an active consent only initials and the accession code (the record cannot be opened). */
export const consentedView = (r: PatientRow): PatientRow =>
  r.hasConsent ? r : { ...r, name: r.initials, mrn: null, ageYears: null, phoneMasked: null }

const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&')

/** True when every query word is the start of some word of the (honorific-stripped, transliterated) name. */
export function nameMatchesQuery(query: string, ...names: string[]): boolean {
  const q = normaliseName(query).plain
  if (!q.length) return false
  return names.some((n) => {
    const words = normaliseName(n).plain
    return q.every((w) => words.some((x) => x.startsWith(w)))
  })
}

async function consentFlags(tx: Tx): Promise<Map<string, boolean>> {
  const rows = await tx.execute<{ patient_id: string; action: string; store: boolean | null }>(sql`
    select distinct on (patient_id) patient_id, action, (purposes->>'store')::boolean as store
    from consents order by patient_id, recorded_at desc, id desc`)
  return new Map(rows.map((r) => [r.patient_id, r.action !== 'withdraw' && r.store === true]))
}

function toRow(p: typeof patients.$inferSelect, consent: Map<string, boolean>): PatientRow {
  const name = decryptField(p.nameEnc)
  const dob = p.dobEnc ? decryptField(p.dobEnc) : null
  return {
    id: p.id, accession: accession(p.id), name, initials: initials(name), ageYears: dob ? ageYears(dob) : null, sex: p.sex,
    mrn: p.mrn, disclosure: p.disclosureStatus, minor: p.minor, deceased: p.deceased, hasConsent: consent.get(p.id) ?? false,
    createdAt: p.createdAt, phoneMasked: p.phoneEnc ? maskPhone(decryptField(p.phoneEnc)) : null,
  }
}

export type SearchMode = 'any' | 'phone' | 'mrn' | 'name'

/** Empty query: the most recently registered. Otherwise the union of phone, MRN, accession and name hits (or just one kind). */
export async function searchPatients(tx: Tx, rawQuery: string, limit = 50, mode: SearchMode = 'any'): Promise<PatientRow[]> {
  const q = rawQuery.trim()
  const consent = await consentFlags(tx)
  if (!q) {
    const rows = await tx.select().from(patients).where(eq(patients.status, 'active')).orderBy(desc(patients.createdAt)).limit(limit)
    return rows.map((p) => toRow(p, consent))
  }
  const ids = new Set<string>()
  const add = (rows: { id: string }[]) => rows.forEach((r) => ids.add(r.id))

  const ph = (mode === 'any' || mode === 'phone') && normalizePhone(q) ? phoneHmac(q) : null
  if (ph) add(await tx.select({ id: patients.id }).from(patients).where(eq(patients.phoneHmac, ph)))
  if (mode === 'any' || mode === 'mrn') add(await tx.select({ id: patients.id }).from(patients).where(ilike(patients.mrn, `${likeEscape(q)}%`)))
  const acc = mode === 'any' ? q.match(/^os[\s·.\-]*([0-9a-f]{6})$/i) : null
  if (acc) {
    add(await tx.select({ id: patients.id }).from(patients)
      .where(sql`replace(${patients.id}::text, '-', '') like ${'%' + acc[1].toLowerCase()}`))
  }
  if ((mode === 'any' || mode === 'name') && /\p{L}/u.test(q) && !acc) {
    // ponytail: decrypt-in-app, O(n) in the org's patients (names are encrypted, so no index can serve this).
    // Fine to a few thousand patients; before that ceiling add a trigram/blind-token index or a search service.
    const all = await tx.select({ id: patients.id, nameEnc: patients.nameEnc }).from(patients).where(eq(patients.status, 'active'))
    const aliases = await tx.select({ patientId: patientAliases.patientId, nameEnc: patientAliases.nameEnc }).from(patientAliases)
    const aliasBy = new Map<string, string[]>()
    for (const a of aliases) aliasBy.set(a.patientId, [...(aliasBy.get(a.patientId) ?? []), decryptField(a.nameEnc)])
    for (const p of all) if (nameMatchesQuery(q, decryptField(p.nameEnc), ...(aliasBy.get(p.id) ?? []))) ids.add(p.id)
  }
  if (!ids.size) return []
  const rows = await tx.select().from(patients).where(and(inArray(patients.id, [...ids].slice(0, limit)), ne(patients.status, 'erased'))).orderBy(desc(patients.createdAt))
  return rows.map((p) => toRow(p, consent))
}
