// Per-request context for every /p/** page: who is signed in, which language, which brand (FR-CON-07).
import { eq } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { brandFor, langFromAcceptLanguage } from '@/core/copy'
import type { Disclosure, Lang } from '@/core/types'
import { withOrg } from '@/db'
import { orgSettings, patients, type OrgFlags } from '@/db/schema'
import { LANG_COOKIE, langParam, pickLang } from './lang'
import { decryptField } from '../crypto'
import { activeConsent, assertPatientAccess, initials, type ActiveConsent } from '../patients'
import { requirePatientSession, type PatientSession } from '../session'

export type PortalCtx = {
  session: PatientSession
  lang: Lang
  /** "Setu Records" unless disclosure is cleared: the word "Onco" never reaches a patient who has not been told. */
  brand: 'OncoSetu' | 'Setu Records'
  disclosure: Disclosure
  initials: string
  /** The patient's first name when a family member is signed in (so wording says "Sunita", not "you"); null for the patient. */
  who: string | null
  primaryContact: 'patient' | 'caregiver'
  flags: OrgFlags
  consent: ActiveConsent | null
  /** Who is acting: every mutation is attributed to this id (FR-CON-02). */
  actor: { kind: 'patient' | 'caregiver'; id: string }
}

/** "Mohd.", "Dr.", "K." are not names: use the whole name then. */
export function firstNameOf(full: string): string {
  const t = full.trim()
  const first = t.split(/\s+/)[0]
  return !first || first.endsWith('.') || first.length < 3 ? t : first
}

const remembered = async () => (await cookies()).get(LANG_COOKIE)?.value

export { langParam }

export type PortalSearch = Promise<{ lang?: string | string[] }>

/** Before sign-in nothing is known about the visitor: the browser's language (Hindi or English). */
export const browserLang = async (): Promise<Lang> =>
  pickLang(null, await remembered(), langFromAcceptLanguage((await headers()).get('accept-language')))

/** Signed-in patient or caregiver, or redirect to /p/login. Language: ?lang= first, then the remembered choice, then the patient's preferred language. */
export async function loadPortal(searchParams?: PortalSearch): Promise<PortalCtx> {
  const session = await requirePatientSession()
  const fromUrl = langParam((await searchParams)?.lang)
  const data = await withOrg(session.orgId, async (tx) => {
    await assertPatientAccess({ db: tx, session }, session.patientId)
    const [p] = await tx.select({
      nameEnc: patients.nameEnc, disclosure: patients.disclosureStatus, primaryContact: patients.primaryContact,
      lang: patients.preferredLanguage,
    }).from(patients).where(eq(patients.id, session.patientId))
    const [s] = await tx.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, session.orgId))
    return { p, flags: s?.flags ?? { voice: false, tts: false, ai_extraction: false }, consent: await activeConsent(tx, session.patientId) }
  })
  return {
    session,
    lang: pickLang(fromUrl, await remembered(), data.p.lang),
    brand: brandFor(data.p.disclosure),
    disclosure: data.p.disclosure,
    initials: initials(decryptField(data.p.nameEnc)),
    who: session.kind === 'caregiver' ? firstNameOf(decryptField(data.p.nameEnc)) : null,
    primaryContact: data.p.primaryContact,
    flags: data.flags,
    consent: data.consent,
    actor: { kind: session.kind, id: session.caregiverId ?? session.patientId },
  }
}
