// Patient registration (J1, FR-ID-01/07, FR-CON-01/03/06/07, E-ID-05/06/08).
import { and, eq } from 'drizzle-orm'
import { encounters, patientAliases, patients } from '@/db/schema'
import { encryptField, hmac, normalizePhone, phoneHmac } from '../crypto'
import { HttpError } from '../http'
import { now } from '../clock'
import { insertCaregiver } from './caregivers'
import { checkOtp, CONSENT_PURPOSE, otpFailure } from './confirm'
import { insertConsent } from './consent'
import { abhaDigits, abhaHmac, findDuplicates } from './duplicates'
import { fail, accession, type StaffCtx } from './http'
import { checkGrantPurposes, estimateDob, generateToken, groupToken, identityKey, isMinorOn, tokenHash, validDob } from './logic'
import type { RegisterBody } from './schemas'

export async function registerPatient(ctx: StaffCtx<RegisterBody>) {
  const { session: s, body: b, db: tx } = ctx
  if (b.disclosureStatus !== 'unknown' && s.role !== 'clinician') {
    throw new HttpError(403, 'forbidden', 'Only a clinician can set the disclosure status')
  }
  const grant = checkGrantPurposes(b.consent.purposes)
  if (!grant.ok) throw new HttpError(400, grant.code, 'Keeping and organising the record is required to register')

  // identity facts
  const at = await now(s.orgId)
  let dob = b.dob ?? null
  const dobEstimated = !dob
  if (dob && !validDob(dob, at)) throw new HttpError(400, 'invalid_dob', 'Enter a real date of birth that is not in the future')
  if (!dob) {
    if (b.age == null) throw new HttpError(400, 'dob_or_age_required', 'Enter a date of birth or an age')
    dob = estimateDob(b.age, at) // ponytail: no "approximate DOB" column; the estimate is flagged in the audit row only
  }
  const minor = isMinorOn(dob, at)
  const primary = minor ? 'caregiver' : b.primaryContact // FR-CON-03: a minor's contact is the guardian

  const phone = b.phone ? normalizePhone(b.phone) : null
  if (b.phone && !phone) throw new HttpError(400, 'invalid_phone', 'Enter a valid phone number')
  const cgPhone = b.caregiver ? normalizePhone(b.caregiver.phone) : null
  if (b.caregiver && !cgPhone) throw new HttpError(400, 'invalid_phone', 'Enter a valid phone number for the caregiver')
  if ((minor || primary === 'caregiver') && !b.caregiver) {
    throw new HttpError(400, 'caregiver_required', minor ? 'A guardian is required for a patient under 18' : 'Enter the caregiver who is the primary contact')
  }
  if (minor && !b.caregiver!.isGuardian) throw new HttpError(400, 'guardian_required', 'The caregiver of a patient under 18 must be recorded as the guardian')

  let abhaDigitsValue: string | null = null
  if (b.abhaNumber) {
    abhaDigitsValue = abhaDigits(b.abhaNumber)
    if (abhaDigitsValue.length !== 14) throw new HttpError(400, 'invalid_abha', 'An ABHA number has 14 digits')
  }

  // MRN is unique per organisation (also across merged records): a clear error instead of a database failure
  if (b.mrn) {
    const [taken] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.orgId, s.orgId), eq(patients.mrn, b.mrn)))
    if (taken) return fail(409, 'mrn_in_use', 'That MRN / UHID already belongs to another record')
  }

  // duplicates, before anything is consumed or saved (E-ID-06)
  const pHmac = phone ? phoneHmac(phone) : null
  const aHmac = abhaDigitsValue ? abhaHmac(abhaDigitsValue) : null
  const realDob = dobEstimated ? null : dob
  const candidates = await findDuplicates(tx, {
    name: b.fullName, aliases: b.aliases.map((a) => a.name), dob: realDob, phoneHmac: pHmac, abhaHmac: aHmac,
    identityHmac: identityKey(b.fullName, realDob), mrn: b.mrn ?? null,
  })
  if (candidates.length && !b.continueDespiteDuplicates) {
    return fail(409, 'possible_duplicate', 'This person may already be registered', { candidates })
  }

  // consent confirmation: a code to the primary contact's phone, or in-person witnessed
  const otpPhone = primary === 'caregiver' ? cgPhone : (phone ?? cgPhone)
  if (b.consent.confirm.method === 'otp') {
    if (!otpPhone) throw new HttpError(400, 'otp_needs_phone', 'There is no phone to send a code to. Use in-person witnessed consent.')
    const r = await checkOtp({ phone: otpPhone, lang: b.preferredLanguage, caregiverId: null }, CONSENT_PURPOSE, b.consent.confirm.code)
    const failure = otpFailure(r)
    if (failure) return failure
  }

  // save
  const token = generateToken()
  const clinicianSet = b.disclosureStatus !== 'unknown'
  const [p] = await tx.insert(patients).values({
    orgId: s.orgId, oncosetuTokenHash: tokenHash(token), mrn: b.mrn ?? null,
    abhaNumberEnc: abhaDigitsValue ? encryptField(abhaDigitsValue) : null, abhaHmac: aHmac, abhaVerified: false, // FR-ID-07: captured, unverified
    nameEnc: encryptField(b.fullName), dobEnc: encryptField(dob), phoneEnc: phone ? encryptField(phone) : null, phoneHmac: pHmac,
    identityHmac: identityKey(b.fullName, realDob), sex: b.sex, minor, disclosureStatus: b.disclosureStatus, primaryContact: primary,
    disclosureSetBy: clinicianSet ? s.staffId : null, disclosureSetAt: clinicianSet ? new Date() : null,
    preferredLanguage: b.preferredLanguage, createdBy: s.staffId,
  }).returning({ id: patients.id })

  for (const a of b.aliases) {
    await tx.insert(patientAliases).values({
      orgId: s.orgId, patientId: p.id, nameEnc: encryptField(a.name), nameHmac: hmac(`alias:${a.name}`), kind: a.kind, createdBy: s.staffId,
    })
  }
  let caregiverId: string | null = null
  if (b.caregiver) {
    caregiverId = await insertCaregiver(tx, {
      orgId: s.orgId, patientId: p.id, staffId: s.staffId, name: b.caregiver.name, relation: b.caregiver.relation,
      phone: b.caregiver.phone, isGuardian: minor || b.caregiver.isGuardian,
    })
  }
  const viaOtp = b.consent.confirm.method === 'otp'
  const caregiverConfirmed = viaOtp && primary === 'caregiver'
  const consentId = await insertConsent(tx, {
    orgId: s.orgId, patientId: p.id, action: 'grant', purposes: b.consent.purposes, noticeVersion: b.consent.noticeVersion,
    language: b.consent.language,
    ...(viaOtp
      ? { actorType: caregiverConfirmed ? 'caregiver' as const : 'patient' as const, actorId: caregiverConfirmed ? caregiverId! : p.id, method: 'self' as const }
      : { actorType: 'staff' as const, actorId: s.staffId, method: 'desk_assisted' as const, witnessedBy: s.staffId }),
  })
  // The person is here and has just consented, so the first (onboarding) encounter starts now.
  const [enc] = await tx.insert(encounters).values({ orgId: s.orgId, patientId: p.id, type: 'onboarding', startedBy: s.staffId }).returning({ id: encounters.id })

  await ctx.audit('patient.registered', 'patient', p.id, {
    minor, disclosure: b.disclosureStatus, primaryContact: primary, consentMethod: b.consent.confirm.method,
    duplicateOverride: candidates.length > 0, dobEstimated, aliases: b.aliases.length, caregiver: !!caregiverId, abhaCaptured: !!aHmac,
  })
  await ctx.audit('consent.recorded', 'patient', p.id, {
    consentId, action: 'grant', noticeVersion: b.consent.noticeVersion, language: b.consent.language,
    method: viaOtp ? 'otp' : 'witnessed', ai: b.consent.purposes.ai, share: b.consent.purposes.share,
    abdm: b.consent.purposes.abdm, metrics: b.consent.purposes.metrics,
  })
  await ctx.audit('patient.token_issued', 'patient', p.id)
  await ctx.audit('encounter.started', 'encounter', enc.id, { patientId: p.id, type: 'onboarding' })

  return { id: p.id, accession: accession(p.id), token, tokenGrouped: groupToken(token), encounterId: enc.id, cardUrl: `/patients/${p.id}/card` }
}
