// ID verification (symbolic): only the last 4 characters of an ID are ever stored. A full Aadhaar number must never
// reach the database (UIDAI rules: only an Aadhaar Data Vault may hold it), so anything longer than 4 characters is refused here.
export const ID_TYPE_LIST = ['aadhaar', 'abha', 'pan', 'voter_id', 'passport', 'driving_licence'] as const
export type IdTypeName = (typeof ID_TYPE_LIST)[number]

export type Last4Result = { ok: true; last4: string } | { ok: false; code: 'full_number' | 'not_four' | 'bad_chars' }

const ALNUM_TYPES: readonly IdTypeName[] = ['pan', 'voter_id', 'passport', 'driving_licence']

/** Accepts exactly four characters (digits; letters allowed for PAN, voter ID, passport and licence). Longer input is rejected, not trimmed. */
export function validateLast4(type: IdTypeName, raw: string): Last4Result {
  const s = raw.replace(/[\s-]/g, '').toUpperCase()
  if (s.length > 4) return { ok: false, code: 'full_number' } // never store, never echo
  if (s.length !== 4) return { ok: false, code: 'not_four' }
  const re = ALNUM_TYPES.includes(type) ? /^[0-9A-Z]{4}$/ : /^[0-9]{4}$/
  return re.test(s) ? { ok: true, last4: s } : { ok: false, code: 'bad_chars' }
}

/** What is shown on screen: never more than the last four. */
export function maskId(type: IdTypeName, last4: string): string {
  return type === 'aadhaar' ? `XXXX XXXX ${last4}` : `•••• ${last4}`
}

export const ID_TYPE_LABEL: Record<IdTypeName, { en: string; hi: string; hinglish: string }> = {
  aadhaar: { en: 'Aadhaar', hi: 'आधार', hinglish: 'Aadhaar' },
  abha: { en: 'ABHA', hi: 'आभा (ABHA)', hinglish: 'ABHA' },
  pan: { en: 'PAN', hi: 'पैन (PAN)', hinglish: 'PAN' },
  voter_id: { en: 'Voter ID', hi: 'मतदाता पहचान पत्र', hinglish: 'Voter ID' },
  passport: { en: 'Passport', hi: 'पासपोर्ट', hinglish: 'Passport' },
  driving_licence: { en: 'Driving licence', hi: 'ड्राइविंग लाइसेंस', hinglish: 'Driving licence' },
}
