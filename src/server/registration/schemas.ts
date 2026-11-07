// Request schemas for the registration routes (zod).
import { z } from 'zod'
import { CONSENT_NOTICE_VERSION } from '@/i18n/consent'
import { ISO_DATE, purposesSchema } from './logic'

export const langSchema = z.enum(['en', 'hi', 'hinglish'])
/** The consent notice also exists in Marathi (src/i18n/consent.ts); the consent row records which one was shown. */
export const consentLangSchema = z.enum(['en', 'hi', 'hinglish', 'mr'])
export const personName = z.string().trim().min(2).max(120)
export const phoneField = z.string().trim().min(5).max(32)

/** How the patient (or caregiver) confirms a sensitive action: a code sent to their phone, or in person with a witness. */
export const confirmSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('otp'), code: z.string().trim().min(4).max(12) }),
  z.object({ method: z.literal('witnessed'), attest: z.literal(true) }),
])
export type Confirm = z.infer<typeof confirmSchema>

export const caregiverInput = z.object({
  name: personName,
  relation: z.string().trim().min(2).max(40),
  phone: phoneField,
  isGuardian: z.boolean().default(false),
})

export const consentInput = z.object({
  purposes: purposesSchema,
  language: consentLangSchema,
  noticeVersion: z.literal(CONSENT_NOTICE_VERSION),
})

export const registerSchema = z.object({
  fullName: personName,
  aliases: z.array(z.object({ name: personName, kind: z.enum(['married', 'transliteration', 'other']) })).max(10).default([]),
  dob: z.string().regex(ISO_DATE).optional(),
  age: z.number().int().min(0).max(120).optional(),
  sex: z.enum(['female', 'male', 'other', 'unknown']),
  phone: phoneField.optional(),
  mrn: z.string().trim().min(1).max(40).optional(),
  abhaNumber: z.string().trim().max(32).optional(),
  preferredLanguage: langSchema.default('en'),
  disclosureStatus: z.enum(['cleared', 'not_cleared', 'unknown']).default('unknown'),
  primaryContact: z.enum(['patient', 'caregiver']).default('patient'),
  caregiver: caregiverInput.optional(),
  consent: consentInput.extend({ confirm: confirmSchema }),
  continueDespiteDuplicates: z.boolean().default(false),
})
export type RegisterBody = z.infer<typeof registerSchema>

/** Same identity fields, no consent: used before saving to look for an existing record. */
export const duplicateCheckSchema = z.object({
  fullName: personName,
  aliases: z.array(z.object({ name: personName })).max(10).default([]),
  dob: z.string().regex(ISO_DATE).optional(),
  phone: phoneField.optional(),
  caregiverPhone: phoneField.optional(),
  mrn: z.string().trim().min(1).max(40).optional(),
  abhaNumber: z.string().trim().max(32).optional(),
})
export type DuplicateCheckBody = z.infer<typeof duplicateCheckSchema>
