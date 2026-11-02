// The consent gate before decryption (FR-ING-ABDM-01): a data push is decrypted only after the HIU's copy of the consent
// artefact is re-checked — GRANTED, not past its erase-at, for this patient, covering the requested HI types and date
// range. A refusal never touches the ciphertext. After decryption each bundle is checked again (its record type and
// date must fall inside the artefact) before anything is written.
import type { AbdmArtefact } from '@/db/schema'
import { decryptEntry, type Ephemeral } from './crypto'
import { entryChecksum, type DataPush, type DateRange } from './transport'

/** The artefact as OncoSetu stores it (abdm_consent_requests.artefact): the patient's ABHA replaced by its blind index. */
export type StoredArtefact = AbdmArtefact
export type GateExpect = { patientHmac: string | null; hiTypes: string[]; dateRange: DateRange; now: Date }
export type GateRefusal = 'no_artefact' | 'not_granted' | 'expired' | 'wrong_patient' | 'hi_type_not_granted' | 'date_range_not_granted'

const t = (iso: string) => Date.parse(iso)

export function checkArtefact(a: StoredArtefact | null | undefined, e: GateExpect): { ok: true } | { ok: false; reason: GateRefusal } {
  if (!a) return { ok: false, reason: 'no_artefact' }
  if (a.status !== 'GRANTED') return { ok: false, reason: 'not_granted' }
  if (!(t(a.dataEraseAt) > e.now.getTime())) return { ok: false, reason: 'expired' }
  if (!e.patientHmac || a.patientHmac !== e.patientHmac) return { ok: false, reason: 'wrong_patient' }
  if (!e.hiTypes.length || e.hiTypes.some((h) => !(a.hiTypes as string[]).includes(h))) return { ok: false, reason: 'hi_type_not_granted' }
  if (!(t(e.dateRange.from) >= t(a.dateRange.from) && t(e.dateRange.to) <= t(a.dateRange.to) && t(e.dateRange.from) <= t(e.dateRange.to))) {
    return { ok: false, reason: 'date_range_not_granted' }
  }
  return { ok: true }
}

/** A decrypted bundle stays only if its record type and document date are inside the artefact. */
export function bundleWithinArtefact(a: StoredArtefact, b: { hiType: string; date: string | null }): boolean {
  return (a.hiTypes as string[]).includes(b.hiType) && !!b.date && b.date >= a.dateRange.from.slice(0, 10) && b.date <= a.dateRange.to.slice(0, 10)
}

export type Opened = { careContextReference: string; plaintext: Buffer }
export type OpenRefusal = GateRefusal | 'decrypt_failed' | 'checksum_mismatch' | 'bad_key_material'

/**
 * Gate, then decrypt every entry (all or nothing: one bad entry refuses the whole push, so nothing partial is written).
 * `hiu` is the HIU's ephemeral key pair for this transfer; the push carries the HIP's key material.
 */
export function openPush(a: StoredArtefact | null | undefined, e: GateExpect, push: DataPush, hiu: Ephemeral): { ok: true; entries: Opened[] } | { ok: false; reason: OpenRefusal } {
  const gate = checkArtefact(a, e)
  if (!gate.ok) return gate
  const entries: Opened[] = []
  for (const x of push.entries) {
    let plaintext: Buffer
    try {
      plaintext = decryptEntry(x.content, hiu, push.keyMaterial, e.now)
    } catch (err) {
      return { ok: false, reason: (err as { code?: string }).code === 'decrypt_failed' ? 'decrypt_failed' : 'bad_key_material' }
    }
    if (entryChecksum(plaintext) !== x.checksum) return { ok: false, reason: 'checksum_mismatch' }
    entries.push({ careContextReference: x.careContextReference, plaintext })
  }
  return { ok: true, entries }
}
