import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { lintText } from '@/core/copy'
import { base32Decode } from '../crypto'
import {
  canonicalToken, checkGrantPurposes, dupReasons, estimateDob, generateToken, groupToken, identityKey, isMinorOn,
  isStrong, isTokenShape, NO_PURPOSES, purposesSchema, TOKEN_BYTES, TOKEN_CHARS, tokenHash, ageAt,
  type DupProfile,
} from './logic'

beforeAll(() => { process.env.HMAC_KEY = randomBytes(32).toString('base64') })

const profile = (over: Partial<DupProfile> & { name: string }): DupProfile => ({
  aliases: [], dob: null, phoneHmac: null, abhaHmac: null, identityHmac: null, mrn: null, ...over,
})
const withKey = (p: DupProfile) => ({ ...p, identityHmac: identityKey(p.name, p.dob) })

describe('duplicate detection (E-ID-06)', () => {
  it('same ABHA number is a strong duplicate even with a different name', () => {
    const r = dupReasons(profile({ name: 'Asha Rao', abhaHmac: 'h1' }), profile({ name: 'Meena Joshi', abhaHmac: 'h1' }))
    expect(r).toEqual(['abha'])
    expect(isStrong(r)).toBe(true)
  })
  it('same person registered twice with honorific, case and script variants (identity_hmac)', () => {
    const a = withKey(profile({ name: 'Sunita Deshmukh', dob: '1974-08-14' }))
    expect(identityKey('Mrs. Sunita Deshmukh', '1974-08-14')).toBe(a.identityHmac)
    expect(identityKey('SUNITA DESHMUKH', '1974-08-14')).toBe(a.identityHmac)
    expect(identityKey('सुनीता देशमुख', '1974-08-14')).toBe(a.identityHmac)
    expect(identityKey('Mohd. Abdul Rahim Khan', '1962-01-02')).toBe(identityKey('Mohammed Abdul Rahim Khan', '1962-01-02'))
    expect(identityKey('Sunita Deshmukh', '1974-08-15')).not.toBe(a.identityHmac)
    expect(identityKey('Sunita Deshmukh', null)).toBeNull()
  })
  it('fuzzy name + same DOB catches a transliteration variant that the exact key misses', () => {
    const a = withKey(profile({ name: 'Venkataraman Iyer', dob: '1962-01-02' }))
    const b = withKey(profile({ name: 'Venkatraman Iyer', dob: '1962-01-02' }))
    expect(a.identityHmac).not.toBe(b.identityHmac)
    const r = dupReasons(a, b)
    expect(r).toContain('name_dob')
    expect(isStrong(r)).toBe(true)
  })
  it('matches through an alias (maiden name)', () => {
    const a = profile({ name: 'Priya Nair', aliases: ['Priya Menon'], dob: '1985-03-09' })
    const b = profile({ name: 'Priya Menon', dob: '1985-03-09' })
    expect(dupReasons(a, b)).toContain('name_dob')
  })
  it('same name with a different DOB is not a duplicate', () => {
    expect(dupReasons(profile({ name: 'Ramesh Kumar', dob: '1970-05-01' }), profile({ name: 'Ramesh Kumar', dob: '1981-11-30' }))).toEqual([])
  })
  it('a phone shared by different people is a weak signal only', () => {
    const r = dupReasons(profile({ name: 'Asha Rao', phoneHmac: 'p1' }), profile({ name: 'Vikram Singh', phoneHmac: 'p1' }))
    expect(r).toEqual(['phone'])
    expect(isStrong(r)).toBe(false)
  })
  it('same name and same phone is strong', () => {
    const r = dupReasons(profile({ name: 'Lakshmi Narayanan', phoneHmac: 'p2' }), profile({ name: 'Smt. Lakshmi Narayanan', phoneHmac: 'p2' }))
    expect(r).toEqual(['name_phone'])
    expect(isStrong(r)).toBe(true)
  })
  it('flags an MRN that differs only in punctuation', () => {
    expect(dupReasons(profile({ name: 'A One', mrn: 'MR-0042' }), profile({ name: 'B Two', mrn: 'mr0042' }))).toEqual(['mrn'])
  })
})

describe('minor detection (FR-CON-03, E-ID-10)', () => {
  const at = new Date('2026-11-02T10:00:00Z') // 15:30 IST
  it('is true up to the day before the 18th birthday and false on it', () => {
    expect(isMinorOn('2008-11-03', at)).toBe(true) // turns 18 tomorrow
    expect(isMinorOn('2008-11-02', at)).toBe(false) // 18 today
    expect(isMinorOn('2020-01-01', at)).toBe(true)
    expect(isMinorOn('1974-08-14', at)).toBe(false)
  })
  it('reads the date in IST: 23:00 UTC on the 1st is already the 2nd in India', () => {
    expect(isMinorOn('2008-11-02', new Date('2026-11-01T23:00:00Z'))).toBe(false)
  })
  it('estimates a DOB from an age that round-trips and keeps minors minors', () => {
    for (const age of [0, 1, 9, 17, 18, 45, 90]) {
      expect(ageAt(estimateDob(age, at), at)).toBe(age)
    }
    expect(isMinorOn(estimateDob(17, at), at)).toBe(true)
    expect(isMinorOn(estimateDob(18, at), at)).toBe(false)
  })
})

describe('consent purposes (FR-CON-01)', () => {
  const all = { store: true, ai: true, share: true, abdm: true, metrics: true }
  it('requires all five purposes as separate booleans and nothing else', () => {
    expect(purposesSchema.safeParse(all).success).toBe(true)
    expect(purposesSchema.safeParse({ ...all, metrics: undefined }).success).toBe(false)
    expect(purposesSchema.safeParse({ ...all, marketing: true }).success).toBe(false)
    expect(purposesSchema.safeParse({ ...all, ai: 'yes' }).success).toBe(false)
  })
  it('store-and-organise is required to proceed; every other purpose is optional', () => {
    expect(checkGrantPurposes({ ...NO_PURPOSES, store: true })).toEqual({ ok: true })
    expect(checkGrantPurposes({ ...all, store: false })).toEqual({ ok: false, code: 'store_required' })
  })
  it('declining AI keeps the other choices untouched (E-CON-01: manual mode only)', () => {
    const p = purposesSchema.parse({ ...all, ai: false })
    expect(p).toEqual({ store: true, ai: false, share: true, abdm: true, metrics: true })
  })
})

describe('opaque token (FR-ID-01)', () => {
  it('is 128 bits of base32 with no structure', () => {
    const t = generateToken()
    expect(t).toMatch(/^[A-Z2-7]{26}$/)
    expect(t).toHaveLength(TOKEN_CHARS)
    expect(base32Decode(t).subarray(0, TOKEN_BYTES)).toHaveLength(TOKEN_BYTES)
    expect(isTokenShape(t)).toBe(true)
  })
  it('never repeats and is not sequential (1,000 tokens)', () => {
    const tokens = Array.from({ length: 1000 }, generateToken)
    expect(new Set(tokens).size).toBe(1000)
    // every one of the 16 byte positions takes many values: nothing counter-like or fixed
    for (let i = 0; i < TOKEN_BYTES; i++) {
      expect(new Set(tokens.map((t) => base32Decode(t)[i])).size).toBeGreaterThan(150)
    }
    const ups = tokens.filter((t, i) => i > 0 && t > tokens[i - 1]).length
    expect(ups).toBeGreaterThan(400)
    expect(ups).toBeLessThan(600) // neither ascending nor descending
  })
  it('carries no PHI: generated without input, and the stored value is an HMAC of it', () => {
    expect(generateToken.length).toBe(0)
    const t = generateToken()
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash(t)).not.toContain(t.toLowerCase())
  })
  it('scanned, typed and grouped forms resolve to the same hash', () => {
    const t = generateToken()
    expect(tokenHash(groupToken(t))).toBe(tokenHash(t))
    expect(tokenHash(` ${t.toLowerCase()} `)).toBe(tokenHash(t))
    expect(canonicalToken(groupToken(t))).toBe(t)
    expect(isTokenShape('short')).toBe(false)
    expect(isTokenShape('1'.repeat(26))).toBe(false) // base32 has no 0/1/8/9
  })
})

describe('printed card copy (FR-CON-07)', () => {
  it('contains no diagnosis words for a non-cleared patient', async () => {
    const { registrationCopy } = await import('@/i18n/registration')
    const { consentCopy } = await import('@/i18n/consent')
    const strings = [
      ...Object.values(registrationCopy.card).flatMap((v) => [v.en, v.hi]),
      registrationCopy.preVisitSms.en('https://x.test/p/login'), registrationCopy.preVisitSms.hi('https://x.test/p/login'),
      registrationCopy.breakGlassSms.en, registrationCopy.breakGlassSms.hi,
      registrationCopy.caregiverAddedSms.en, registrationCopy.caregiverAddedSms.hi,
      registrationCopy.primaryContactSms.en, registrationCopy.primaryContactSms.hi,
      consentCopy.intro.en, consentCopy.intro.hi, consentCopy.ai.detail.en, consentCopy.ai.detail.hi,
    ]
    for (const s of strings) expect(lintText(s, ['diagnosis', 'radar'])).toEqual([])
  })
})
