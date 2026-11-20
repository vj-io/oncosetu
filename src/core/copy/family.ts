// What a family member may be shown of a paper's own words (FR-CON-07 and the privacy rule for patient surfaces).
// A physician's name and the signature footer at the bottom of a report belong to the paper, not to the family-facing lists,
// quotes and links. Pure and client-safe.

const NAME_RE = /[A-Z][A-Za-z.-]*(?:[ \t]+[A-Z][A-Za-z.-]*){0,2}(?:['’]s)?/
const TITLE_RE = /\b(?:Dr|DR|dr|Prof|PROF|Professor|Doctor)\b\.?[ \t]*/

/** "Dr. A. Kumar", "Prof Rao": a titled person's name. */
const TITLED = new RegExp(TITLE_RE.source + NAME_RE.source, 'g')
/** Lines that only carry who wrote, signed, checked or printed the paper, or a doctor's name after a role word. */
const FOOTER_LINES = [
  /^[ \t*_-]*(?:electronically[ \t]+|digitally[ \t]+)?(?:signed|verified|reported|authori[sz]ed|dictated|typed|printed|approved|validated|checked|generated|reviewed|prepared|entered)[ \t]*(?:and[ \t]+\w+[ \t]+)?(?:by|on|at|date)\b.*$/gim,
  /^[ \t*_-]*(?:consultant|pathologist|radiologist|oncologist|surgeon|physician|doctor|reporting[ \t]+(?:doctor|radiologist|pathologist)|referred[ \t]+by|referring[ \t]+(?:doctor|physician)|treating[ \t]+(?:doctor|physician)|incharge|in-charge|signature|sign)\b[ \t]*(?::|-|–|—)[^\n]*$/gim,
  /^[ \t*_-]*(?:\*+[ \t]*)?end[ \t]+of[ \t]+(?:the[ \t]+)?report\b.*$/gim,
  /^[ \t*_-]*(?:this[ \t]+is[ \t]+(?:a[ \t]+)?(?:computer|system)[ \t-]+generated\b|not[ \t]+valid[ \t]+for[ \t]+medico[ \t-]?legal\b|disclaimer\b|note[ \t]*:[ \t]*clinical[ \t]+correlation\b).*$/gim,
  /^[ \t]*page[ \t]+\d+[ \t]*(?:of|\/)[ \t]*\d+[ \t]*$/gim,
  /^[ \t*_-]*(?:mbbs|md|ms|dnb|dm|mch|frcr|frcpath)\b[^\n]{0,80}$/gim,
]
/** "MBBS, MD, DNB" after a name. */
const DEGREES = /,?[ \t]*\b(?:MBBS|DNB|FRCR|FRCPath|MCh|DMRD|DMRT)\b(?:[ \t]*[,&][ \t]*(?:MBBS|MD|MS|DNB|DM|MCh|FRCR|FRCPath|DMRD|DMRT|DCP))*/g

export const NAME_REMOVED = '[name removed]'

/**
 * The paper's words without a physician's name or the signature footer: footer lines go, a titled name becomes
 * "[name removed]", and a degree string after a name goes. Empty text stays empty.
 */
export function stripPhysician(text: string | null | undefined): string {
  let t = text ?? ''
  for (const re of FOOTER_LINES) t = t.replace(re, '')
  t = t.replace(TITLED, NAME_REMOVED).replace(DEGREES, '')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/** A place or label with any titled physician name taken out ("Dr. R. Mehta Cancer Clinic" → "Cancer Clinic"); text is returned unchanged when it names nobody. */
export function withoutPhysician(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const out = t.replace(TITLED, ' ').replace(DEGREES, '').replace(/\s{2,}/g, ' ').replace(/^\s*(?:['’]s)?[\s,.;-]*/, '').replace(/[\s,;-]+$/, '').trim()
  return out
}

/** True when stripping would change the text: it names a physician or carries a footer. */
export const namesPhysician = (text: string | null | undefined) => stripPhysician(text) !== (text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()

/** A source quote shown to a family: stripped, and dropped (null) when what is left is only the removed name or too short to mean anything. */
export function familySafeQuote(quote: string | null | undefined): string | null {
  const t = stripPhysician(quote).replace(/\n+/g, ' ').trim()
  const rest = t.split(NAME_REMOVED).join('').replace(/[^\p{L}\p{N}]+/gu, '')
  return rest.length >= 6 ? t : null
}

/**
 * A document title for a family: never the uploaded file's own name (it can carry a real name, e.g. "RAMESH_K_PET_report.pdf").
 * The kind of paper and its date, or the kind alone.
 */
export function familyDocTitle(label: string, dated: string | null): string {
  return dated ? `${label}, ${dated}` : label
}

/** ZIP entries a patient sent that were left out: the reason only, with a neutral "File n" in place of the file's own name. */
export function neutralSkipped<T extends { reason: string }>(skipped: readonly (T & { name?: string })[]): { name: string; reason: string }[] {
  return skipped.map((s, i) => ({ name: `File ${i + 1}`, reason: s.reason }))
}
