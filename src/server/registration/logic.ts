// Pure registration logic: minors, duplicate detection, consent purposes, tokens. No DB, no IO (unit-tested).
import { z } from 'zod'
import { istDate } from '@/core/copy'
import { ageOn, compareNames, normaliseName } from '@/core/identity'
import type { ConsentPurposes } from '@/db/schema'
import { hmac, randomToken } from '../crypto'

// ── age, minors ──────────────────────────────────────────────────────────────
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const ADULT_AGE = 18

/** Whole years at `at` (read in IST). */
export const ageAt = (dob: string, at: Date) => ageOn(dob, istDate(at.toISOString()))

/** FR-CON-03: under 18 on `at` → guardian consent, record flagged minor. */
export const isMinorOn = (dob: string, at: Date) => ageAt(dob, at) < ADULT_AGE

/** Only an age was given: the date that makes that exact age today. The caller records that it is an estimate. */
export function estimateDob(age: number, at: Date): string {
  const [y, m, d] = istDate(at.toISOString()).split('-').map(Number)
  return new Date(Date.UTC(y - age, m - 1, d)).toISOString().slice(0, 10)
}

// ── consent purposes (FR-CON-01) ─────────────────────────────────────────────
export const purposesSchema = z.object({
  store: z.boolean(), ai: z.boolean(), share: z.boolean(), abdm: z.boolean(), metrics: z.boolean(),
}).strict()

export const NO_PURPOSES: ConsentPurposes = { store: false, ai: false, share: false, abdm: false, metrics: false }

/** A grant or update must include "store and organise": without it there is no record to keep. */
export function checkGrantPurposes(p: ConsentPurposes): { ok: true } | { ok: false; code: 'store_required' } {
  return p.store ? { ok: true } : { ok: false, code: 'store_required' }
}

// ── tokens (FR-ID-01) ────────────────────────────────────────────────────────
export const TOKEN_BYTES = 16 // 128 bits
export const TOKEN_CHARS = 26 // ceil(128 / 5) base32 characters
const TOKEN_SHAPE = new RegExp(`^[A-Z2-7]{${TOKEN_CHARS}}$`)

/** Random 128-bit token, base32 (A–Z, 2–7). Takes no input: it cannot carry patient data. */
export const generateToken = () => randomToken(TOKEN_BYTES, 'base32')

/** Typed or scanned tokens may be grouped, spaced or lower-case. */
export const canonicalToken = (s: string) => s.toUpperCase().replace(/[\s-]/g, '')
export const isTokenShape = (s: string) => TOKEN_SHAPE.test(canonicalToken(s))
/** Only this HMAC is stored (patients.oncosetu_token_hash). */
export const tokenHash = (s: string) => hmac(canonicalToken(s))
/** Printed under the QR for manual entry: ABCD-EFGH-… */
export const groupToken = (t: string) => canonicalToken(t).match(/.{1,4}/g)!.join('-')

// ── duplicates (E-ID-06) ─────────────────────────────────────────────────────
export type DupProfile = {
  name: string; aliases: string[]; dob: string | null
  phoneHmac: string | null; abhaHmac: string | null; identityHmac: string | null; mrn: string | null
}
export type DupReason = 'abha' | 'identity' | 'name_dob' | 'name_phone' | 'phone' | 'mrn'
/** Everything except a bare shared phone (families share phones) is a strong signal. */
export const isStrong = (r: DupReason[]) => r.some((x) => x !== 'phone' && x !== 'mrn')

/** Honorific- and transliteration-tolerant key of name + DOB, as a blind index. null when there is no real DOB. */
export function identityKey(name: string, dob: string | null): string | null {
  if (!dob) return null
  const n = normaliseName(name)
  return n.tokens.length ? hmac(`identity:${n.tokens.join(' ')}|${dob}`) : null
}

const normMrn = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

function namesMatch(a: DupProfile, b: DupProfile): boolean {
  for (const x of [a.name, ...a.aliases]) {
    for (const y of [b.name, ...b.aliases]) {
      if (compareNames(x, y).verdict === 'match' || compareNames(y, x).verdict === 'match') return true
    }
  }
  return false
}

/** Why `b` (an existing record) may be the same person as `a` (the new registration). Empty = unrelated. */
export function dupReasons(a: DupProfile, b: DupProfile): DupReason[] {
  const out: DupReason[] = []
  if (a.abhaHmac && a.abhaHmac === b.abhaHmac) out.push('abha')
  if (a.identityHmac && a.identityHmac === b.identityHmac) out.push('identity')
  const samePhone = !!a.phoneHmac && a.phoneHmac === b.phoneHmac
  const sameDob = !!a.dob && a.dob === b.dob
  if (samePhone || sameDob) {
    const same = namesMatch(a, b)
    if (same && sameDob && !out.includes('identity')) out.push('name_dob')
    if (same && samePhone) out.push('name_phone')
  }
  if (samePhone && !out.includes('name_phone')) out.push('phone')
  if (a.mrn && b.mrn && normMrn(a.mrn) === normMrn(b.mrn)) out.push('mrn')
  return out
}

/** A real calendar date, not in the future (IST), not before 1900. */
export function validDob(dob: string, at: Date): boolean {
  const [y, m, d] = dob.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && dob <= istDate(at.toISOString())
}
