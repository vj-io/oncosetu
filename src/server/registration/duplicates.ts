// Duplicate-patient detection before saving (E-ID-06). Merging is the Admin agent's; this only warns.
import { ne } from 'drizzle-orm'
import type { Tx } from '@/db'
import { patientAliases, patients } from '@/db/schema'
import { decryptField, hmac, maskPhone } from '../crypto'
import { ageYears, initials } from '../patients'
import { accession } from './http'
import { dupReasons, identityKey, isStrong, type DupProfile, type DupReason } from './logic'

export const abhaDigits = (raw: string) => raw.replace(/\D/g, '')
export const abhaHmac = (digits: string) => hmac(`abha:${digits}`)

export type DuplicateCandidate = {
  id: string; accession: string; initials: string; ageYears: number | null; mrn: string | null
  phoneMasked: string | null; reasons: DupReason[]; strong: boolean
  /** MRN identical: the database will refuse a second record with it, so "continue anyway" is not offered. */
  blocking: boolean
}

/**
 * Existing records that may be the same person. Phone, ABHA and exact name+DOB are indexed lookups folded into one
 * pass; fuzzy name+DOB needs every name decrypted.
 */
export async function findDuplicates(tx: Tx, input: DupProfile): Promise<DuplicateCandidate[]> {
  // ponytail: decrypt-in-app, O(n) in the org's active patients per registration. Fine to a few thousand records;
  // beyond that pre-filter by blind indexes (phone/ABHA/identity_hmac) and only fuzzy-match the DOB-equal rows.
  const rows = await tx.select().from(patients).where(ne(patients.status, 'merged'))
  const aliasRows = await tx.select({ patientId: patientAliases.patientId, nameEnc: patientAliases.nameEnc }).from(patientAliases)
  const aliasBy = new Map<string, string[]>()
  for (const a of aliasRows) aliasBy.set(a.patientId, [...(aliasBy.get(a.patientId) ?? []), decryptField(a.nameEnc)])

  // Caregiver phones are deliberately not matched: a family phone is not evidence of a duplicate patient.
  const out: DuplicateCandidate[] = []
  for (const p of rows) {
    const name = decryptField(p.nameEnc)
    const dob = p.dobEnc ? decryptField(p.dobEnc) : null
    const cand: DupProfile = {
      name, aliases: aliasBy.get(p.id) ?? [], dob, phoneHmac: p.phoneHmac, abhaHmac: p.abhaHmac,
      identityHmac: p.identityHmac ?? identityKey(name, dob), mrn: p.mrn,
    }
    const reasons = dupReasons(input, cand)
    if (!reasons.length) continue
    out.push({
      id: p.id, accession: accession(p.id), initials: initials(name), ageYears: dob ? ageYears(dob) : null, mrn: p.mrn,
      phoneMasked: p.phoneEnc ? maskPhone(decryptField(p.phoneEnc)) : null, reasons, strong: isStrong(reasons),
      blocking: !!input.mrn && p.mrn === input.mrn,
    })
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.reasons.length - a.reasons.length).slice(0, 5)
}
