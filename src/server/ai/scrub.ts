// Before page text goes to an AI provider, this patient's direct identifiers are replaced with placeholders, and the
// provider's answer gets the original text back. What leaves the server: the clinical text, without the patient's name or
// aliases (any word order, any case, first name alone), hospital numbers, date of birth, and without any phone number,
// e-mail address or 12/14-digit government ID (Aadhaar, ABHA) of anyone. The evidence gate still checks every quote
// against the original page, because placeholders in the answer are restored first.
export type Identity = { name: string; aliases?: string[]; dob?: string | null; mrns?: string[] }
export type Scrubber = { scrub: (text: string) => string; restore: <T>(value: T) => T }

// Words that are names in a test or de-identified record but ordinary words in a report.
const STOP = new Set(['test', 'patient', 'report', 'name', 'mrs', 'miss', 'smt', 'shri', 'kumari', 'baby', 'master', 'unknown', 'case'])
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function dobForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return []
  const [, y, mo, d] = m, yy = y.slice(2), dn = String(Number(d)), mn = String(Number(mo)), mon = MONTHS[Number(mo) - 1]
  return [`${y}-${mo}-${d}`, `${y}/${mo}/${d}`,
    ...[d, dn].flatMap((dd) => [mo, mn].flatMap((mm) => ['/', '-', '.'].flatMap((s) => [`${dd}${s}${mm}${s}${y}`, `${dd}${s}${mm}${s}${yy}`]))),
    `${d} ${mon} ${y}`, `${dn} ${mon} ${y}`, `${d}-${mon}-${y}`, `${d}-${mon}-${yy}`, `${mon} ${dn}, ${y}`]
}

export function makeScrubber(id: Identity): Scrubber {
  const rules: { kind: string; re: RegExp }[] = []
  const tokens = [...new Set([id.name, ...(id.aliases ?? [])].flatMap((n) => n.split(/[\s.,'-]+/)).map((t) => t.trim()).filter((t) => t.length >= 3 && !STOP.has(t.toLowerCase())))]
  if (tokens.length) rules.push({ kind: 'PATIENT_NAME', re: new RegExp(`(?<![\\p{L}])(?:${tokens.map(esc).join('|')})(?![\\p{L}])`, 'giu') })
  const mrns = (id.mrns ?? []).map((m) => m.trim()).filter((m) => m.length >= 3)
  if (mrns.length) rules.push({ kind: 'PATIENT_ID', re: new RegExp(`(?<![\\w])(?:${mrns.map((m) => esc(m).replace(/[\s-]+/g, '[\\s-]*')).join('|')})(?![\\w])`, 'gi') })
  const dobs = id.dob ? dobForms(id.dob) : []
  if (dobs.length) rules.push({ kind: 'DOB', re: new RegExp(`(?<![\\w/.-])(?:${dobs.map(esc).join('|')})(?![\\w/-]|\\.\\d)`, 'gi') })
  rules.push(
    { kind: 'EMAIL', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
    { kind: 'GOV_ID', re: /(?<![\d-])(?:\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}|\d{4}[\s-]\d{4}[\s-]\d{4}|\d{12}|\d{14})(?![\d-])/g },
    { kind: 'PHONE', re: /(?<![\d.])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d.])/g },
  )
  const toPlaceholder = new Map<string, string>(), toOriginal = new Map<string, string>()
  const counts = new Map<string, number>()
  const placeholderFor = (kind: string, original: string) => {
    let p = toPlaceholder.get(original)
    if (!p) {
      const n = (counts.get(kind) ?? 0) + 1
      counts.set(kind, n)
      p = `[${kind}_${n}]`
      toPlaceholder.set(original, p); toOriginal.set(p, original)
    }
    return p
  }
  const scrub = (text: string) => rules.reduce((t, r) => t.replace(r.re, (m) => placeholderFor(r.kind, m)), text)
  const back = /\[(?:PATIENT_NAME|PATIENT_ID|DOB|EMAIL|GOV_ID|PHONE)_\d+\]/g
  const restore = <T>(value: T): T => {
    if (typeof value === 'string') return value.replace(back, (p) => toOriginal.get(p) ?? p) as T
    if (Array.isArray(value)) return value.map(restore) as T
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)])) as T
    return value
  }
  return { scrub, restore }
}
