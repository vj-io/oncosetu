// "First look" for a clinician: what is new, what papers are missing, what a person must still check.
// Pure. Every row is a count or a verbatim quote with a link to the detail. No interpretation.

export type HeldKind = 'wrong_patient' | 'handwriting' | 'identity_unclear' | 'low_quality'

export type HeldDoc = { id: string; docLabel: string; kind: HeldKind; date: string | null }

export type FirstLookInput = {
  patientId: string
  /** Last sealed visit, if any. */
  seal: { id: string; seq: number; sealedLabel: string; signerName: string | null } | null
  /** Items that arrived or changed since that seal (all items if none is sealed). */
  /** How many items are new in all (newItems is only the few shown). */
  newTotal: number
  newItems: { id: string; typeLabel: string; headline: string | null; when: string; quote: string | null }[]
  amended: number
  patientSaid: number
  conflicts: { key: string; label: string }[]
  missing: { id: string; title: string; askAt: string | null; state: string }[]
  held: HeldDoc[]
  unverified: number
  disputed: number
}

export type FirstLookRow = {
  key: 'new' | 'missing' | 'held' | 'conflicts' | 'unverified' | 'sealed'
  /** Plain label, e.g. "Papers not in file". */
  label: string
  /** Headline number, or null for the seal row. */
  count: number | null
  tone: 'conflict' | 'unverified' | 'setu' | 'neutral' | 'verified'
  summary: string
  href: string
  linkLabel: string
  details: { text: string; quote?: string; href?: string; meta?: string }[]
}

export const HELD_WORDS: Record<HeldKind, string> = {
  wrong_patient: 'May belong to another patient. Held out of the record until a person decides.',
  handwriting: 'Handwritten. Kept as an image only; nothing was read from it.',
  identity_unclear: 'The name or details on it could not be matched. Held until a person decides.',
  low_quality: 'Hard to read. A person should check the numbers against the page.',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function buildFirstLook(i: FirstLookInput): FirstLookRow[] {
  const base = `/patients/${i.patientId}`
  const rows: FirstLookRow[] = []

  const nNew = i.newTotal
  rows.push({
    key: 'new', label: i.seal ? 'New since the last sealed visit' : 'On file so far', count: nNew, tone: nNew ? 'setu' : 'neutral',
    summary: nNew
      ? [plural(nNew, 'item'), i.amended ? `${plural(i.amended, 'corrected report')}` : null, i.patientSaid ? `${i.patientSaid} from the patient's own answers` : null].filter(Boolean).join(' · ')
      : i.seal ? 'Nothing new has arrived since that visit.' : 'No items yet.',
    href: `${base}/ledger#new`, linkLabel: 'See what changed',
    details: i.newItems.slice(0, 4).map((n) => ({ text: [n.typeLabel, n.headline].filter(Boolean).join(': '), meta: n.when, quote: n.quote ? clip(n.quote) : undefined, href: `${base}/ledger#item-${n.id}` })),
  })

  rows.push({
    key: 'missing', label: 'Papers not in file', count: i.missing.length, tone: i.missing.length ? 'unverified' : 'verified',
    summary: i.missing.length ? 'Other papers mention these, but we do not hold them. Not in file does not mean it was not done.' : 'No referred-to paper is missing.',
    href: `${base}/completeness`, linkLabel: 'Open the checklist and make a request letter',
    details: i.missing.slice(0, 4).map((m) => ({ text: m.title, meta: m.askAt ? `Ask at ${m.askAt}` : 'Place not stated', href: `${base}/completeness#m-${m.id}` })),
  })

  rows.push({
    key: 'held', label: 'Held for a person to check', count: i.held.length, tone: i.held.length ? 'conflict' : 'verified',
    summary: i.held.length ? 'Held back because the name did not match, or because it is handwritten or hard to read.' : 'Nothing is waiting for an identity or reading check.',
    href: `${base}/documents`, linkLabel: 'Review the held documents',
    details: i.held.slice(0, 4).map((h) => ({ text: h.docLabel, meta: HELD_WORDS[h.kind], href: `${base}/documents/${h.id}` })),
  })

  rows.push({
    key: 'conflicts', label: 'Sources that disagree', count: i.conflicts.length, tone: i.conflicts.length ? 'conflict' : 'verified',
    summary: i.conflicts.length ? 'Two sources give different values. Both quotes are shown; a clinician decides.' : 'No two sources disagree.',
    href: `${base}/ledger#conflicts`, linkLabel: 'Compare the two quotes',
    details: i.conflicts.slice(0, 3).map((c) => ({ text: c.label, href: `${base}/ledger#conflicts` })),
  })

  rows.push({
    key: 'unverified', label: 'Not yet checked against the page', count: i.unverified, tone: i.unverified ? 'unverified' : 'verified',
    summary: i.unverified
      ? `${plural(i.unverified, 'item')} not yet checked by a person${i.disputed ? ` (${i.disputed} disputed)` : ''}. They are shown, but marked as unchecked.`
      : 'Every item has been checked by a person.',
    href: `${base}/ledger#all`, linkLabel: 'Check them', details: [],
  })

  rows.push({
    key: 'sealed', label: 'Last sealed visit', count: null, tone: i.seal ? 'verified' : 'neutral',
    summary: i.seal ? `Sealed ${i.seal.sealedLabel}${i.seal.signerName ? ` by ${i.seal.signerName}` : ''}. Nobody can change it afterwards.` : 'Nothing sealed yet. A clinician seals the record at the end of a visit.',
    href: i.seal ? `/verify/${i.seal.id}` : `${base}/ledger`, linkLabel: i.seal ? 'Check the seal' : 'Open the ledger', details: [],
  })
  return rows
}

/** Held documents from raw flags. Identity decides first (a wrong patient matters most), then handwriting, then reading quality. */
export function classifyHeld(d: { identityResult: string; handwritten: boolean | null; lowConfidence: boolean }): HeldKind {
  if (d.identityResult === 'mismatch') return 'wrong_patient'
  if (d.handwritten) return 'handwriting'
  if (d.identityResult === 'insufficient' || d.identityResult === 'pending') return 'identity_unclear'
  return 'low_quality'
}
