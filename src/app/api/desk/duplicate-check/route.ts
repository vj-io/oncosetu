import { route } from '@/server/http'
import { phoneHmac } from '@/server/crypto'
import { abhaDigits, abhaHmac, findDuplicates } from '@/server/registration/duplicates'
import { identityKey } from '@/server/registration/logic'
import { duplicateCheckSchema } from '@/server/registration/schemas'

// Called by the wizard before the consent step: warns about an existing record (E-ID-06). Never blocks except on an MRN clash.
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: duplicateCheckSchema }, async (ctx) => {
  const b = ctx.body
  const digits = b.abhaNumber ? abhaDigits(b.abhaNumber) : ''
  const candidates = await findDuplicates(ctx.db, {
    name: b.fullName, aliases: b.aliases.map((a) => a.name), dob: b.dob ?? null,
    phoneHmac: b.phone ? phoneHmac(b.phone) : null, abhaHmac: digits.length === 14 ? abhaHmac(digits) : null,
    identityHmac: identityKey(b.fullName, b.dob ?? null), mrn: b.mrn ?? null,
  })
  await ctx.audit('patient.duplicate_check', null, null, { candidates: candidates.length, strong: candidates.filter((c) => c.strong).length })
  return { candidates }
})
