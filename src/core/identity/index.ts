// Header identity decision (FR-ID-03/04, E-ID-01..05). Pure; deterministic.
import { daysBetween, parseDate } from '../dates'

export interface PatientIdentity {
  name: string
  /** Previous / alternate names, e.g. maiden name (E-ID-05). */
  aliases?: string[]
  /** `YYYY-MM-DD` */
  dob?: string | null
  /** 'M' | 'F' | 'O' or any raw form normaliseSex understands */
  sex?: string | null
  mrns?: string[]
}

export interface HeaderIdentity {
  name?: string | null
  /** Raw ("52 Y", "52 Yrs", "6 M", "52 वर्ष") or years as a number. */
  age?: string | number | null
  /** Raw or ISO. */
  dob?: string | null
  sex?: string | null
  mrn?: string | null
}

export type IdentityResult = 'match' | 'mismatch' | 'insufficient'

export interface IdentityDecision {
  result: IdentityResult
  /** Best name similarity, 0..1. */
  score: number
  /** Why the result is mismatch/insufficient (codes). */
  reasons: string[]
  /** Supporting observations (codes), e.g. matched_on_alias, transliteration_variant, mrn_match. */
  notes: string[]
}

// ---------- Devanagari → Latin ----------

const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
}
const NUKTA: Record<string, string> = { k: 'q', kh: 'kh', g: 'g', j: 'z', d: 'r', dh: 'rh', ph: 'f', y: 'y' }
const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o',
}
const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
}
const VIRAMA = '्'
const NUKTA_SIGN = '़'

interface Unit {
  c: string
  v: string
  inherent: boolean
  /** consonants in the cluster */
  n: number
}

function translitWord(word: string): string {
  const units: Unit[] = []
  let cluster = ''
  let n = 0
  const flush = (v: string, inherent: boolean) => {
    units.push({ c: cluster, v, inherent, n })
    cluster = ''
    n = 0
  }
  const chars = [...word]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (CONS[ch] !== undefined) {
      let c = CONS[ch]
      if (chars[i + 1] === NUKTA_SIGN) {
        c = NUKTA[c] ?? c
        i++
      }
      n++
      if (chars[i + 1] === VIRAMA) {
        cluster += c
        i++
      } else if (MATRAS[chars[i + 1]] !== undefined) {
        cluster += c
        flush(MATRAS[chars[i + 1]], false)
        i++
      } else {
        cluster += c
        flush('a', true)
      }
    } else if (VOWELS[ch] !== undefined) {
      if (cluster) flush('', false)
      units.push({ c: '', v: VOWELS[ch], inherent: false, n: 0 })
    } else if (ch === 'ं' || ch === 'ँ') {
      if (units.length) units[units.length - 1].v += 'n'
    } else if (ch === 'ः') {
      if (units.length) units[units.length - 1].v += 'h'
    } else if (ch === NUKTA_SIGN || ch === VIRAMA) {
      // stray sign
    } else {
      if (cluster) flush('', false)
      units.push({ c: ch, v: '', inherent: false, n: 0 })
    }
  }
  if (cluster) flush('', false)
  // Schwa deletion: word-final inherent 'a'; medial inherent 'a' in V C _a C V context (simplified Ohala rule).
  const drop = new Array(units.length).fill(false)
  const last = units.length - 1
  if (units.length > 1 && units[last].inherent) drop[last] = true
  for (let i = 1; i < last; i++) {
    const prevHasVowel = !drop[i - 1] && units[i - 1].v !== ''
    const nextHasVowel = !drop[i + 1] && units[i + 1].v !== '' && units[i + 1].n === 1
    if (units[i].inherent && prevHasVowel && nextHasVowel && !drop[i - 1]) drop[i] = true
  }
  return units.map((u, i) => u.c + (drop[i] ? '' : u.v)).join('')
}

/** Devanagari → Latin (ISO-ish, Hindi schwa deletion). Non-Devanagari characters pass through. */
export function transliterate(text: string): string {
  return text.normalize('NFC').replace(/[ऀ-ॿ]+/g, (w) => translitWord(w))
}

// ---------- names ----------

const CANONICAL: Record<string, string> = {
  md: 'mohammad', mohd: 'mohammad', mohammed: 'mohammad', mohammad: 'mohammad', muhammad: 'mohammad',
  muhammed: 'mohammad', mohamed: 'mohammad', mohamad: 'mohammad', mohmmad: 'mohammad', mohmad: 'mohammad',
  mahammad: 'mohammad', mohummad: 'mohammad', kumari: 'kumar',
  // common surname spellings that differ by more than the phonetic rules cover
  verma: 'varma', sinh: 'sing',
}
/** Honorifics (stripped only from the front); compared by phonetic key, so Devanagari forms match too. */
const HONORIFICS = [
  'mr', 'mrs', 'ms', 'miss', 'smt', 'shrimati', 'shreematee', 'shreemtee', 'shri', 'sri', 'shree', 'sr', 'sushri',
  'kum', 'km', 'ku', 'dr', 'do', 'doctor', 'master', 'mastar', 'baby', 'bebi', 'mst', 'late', 'prof', 'janab', 'begum',
]
/** Tokens that are often present in one record and absent in another. */
const WEAK = new Set(['kumar', 'devi', 'debi', 'bai', 'ben', 'bibi', 'begum', 'rani'])
const RELATION = /(?:^|\s)(?:[wsdhcfm]\s*\/\s*o|wife\s+of|son\s+of|daughter\s+of|husband\s+of|care\s+of|father\s+of|mother\s+of|पत्नी|पुत्र|पुत्री|पति|सुपुत्र|सुपुत्री)(?=[\s.:,]|$).*$/iu
const BABY_OF = /(?:^|\s)(?:b\s*\/\s*o|baby\s+of|बेबी\s+ऑफ़?)(?=[\s.:,]|$)/iu

export function phoneticKey(token: string): string {
  let t = token.toLowerCase().replace(/[^a-z]/g, '')
  if (CANONICAL[t]) return CANONICAL[t]
  t = t
    .replace(/que$/, 'k')
    .replace(/qu/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/ph/g, 'f')
    .replace(/chh/g, 'ch')
    .replace(/tch/g, 'ks') // Tamil -kshi written -tchi (Meenatchi, Kamatchi)
    .replace(/sh/g, 's')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/bh/g, 'b')
    .replace(/jh/g, 'j')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/ou/g, 'au')
    .replace(/(.)\1+/g, '$1')
    .replace(/y$/, 'i')
  return CANONICAL[t] ?? t
}

const HONORIFIC_KEYS = new Set(HONORIFICS.map(phoneticKey))

export interface NameParts {
  /** Phonetic keys of full tokens (length ≥ 2). */
  tokens: string[]
  /** First letters of initials. */
  initials: string[]
  babyOf: boolean
  /** Lowercase latin tokens before phonetic keying (for "variant" notes). */
  plain: string[]
}

/** Strips honorifics and W/o-S/o-D/o clauses, transliterates, splits into phonetic tokens and initials. */
export function normaliseName(raw: string): NameParts {
  const nfc = raw.normalize('NFC')
  const babyOf = BABY_OF.test(nfc)
  const withoutClause = nfc.replace(RELATION, ' ')
  const latin = transliterate(withoutClause)
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
  let words = latin.split(/\s+/).filter(Boolean)
  // Split consonant-only 2-letter caps ("SK") into initials.
  words = words.flatMap((w) => (/^[A-Z]{2}$/.test(w) && !/[AEIOU]/.test(w) && !CANONICAL[w.toLowerCase()] ? w.split('') : [w]))
  const lower = words.map((w) => w.toLowerCase())
  // Leading honorifics; "Kumari" (any spelling) only as a leading title — "Kumar" stays a name.
  const isHonorific = (w: string) => HONORIFIC_KEYS.has(phoneticKey(w)) || (phoneticKey(w) === 'kumar' && w !== 'kumar')
  while (lower.length > 1 && isHonorific(lower[0])) lower.shift()
  const tokens: string[] = []
  const initials: string[] = []
  const plain: string[] = []
  for (const w of lower) {
    if (w.length === 1) initials.push(w)
    else {
      tokens.push(phoneticKey(w))
      plain.push(w)
    }
  }
  return { tokens, initials, babyOf, plain }
}

/** Jaro–Winkler similarity (prefix scale 0.1, max prefix 4). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array(a.length).fill(false)
  const bm = new Array(b.length).fill(false)
  let m = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true
        m++
        break
      }
    }
  }
  if (!m) return 0
  let t = 0
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue
    while (!bm[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3
  let p = 0
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

export const TOKEN_THRESHOLD = 0.92
/** Keys shorter than this must match exactly (JW is unreliable for short names: Priya/Piya). */
export const MIN_FUZZY_LEN = 6

function tokenSim(a: string, b: string): number {
  if (a === b) return 1
  // Joined tokens ('+' prefix, see variants) only match exactly.
  if (a[0] === '+' || b[0] === '+') return a.replace('+', '') === b.replace('+', '') ? 1 : 0
  if (Math.min(a.length, b.length) < MIN_FUZZY_LEN) return 0
  const s = jaroWinkler(a, b)
  return s >= TOKEN_THRESHOLD ? s : 0
}

type NameVerdict = { verdict: 'match' | 'mismatch' | 'insufficient'; score: number; reason?: string; variant: boolean }

/** Joining two adjacent tokens covers "Sai Kumar" vs "Saikumar". */
function variants(tokens: string[]): string[][] {
  const out = [tokens]
  for (let i = 0; i + 1 < tokens.length; i++) out.push([...tokens.slice(0, i), '+' + phoneticKey(tokens[i] + tokens[i + 1]), ...tokens.slice(i + 2)])
  return out
}

function compareTokens(h: string[], hi: string[], p: string[], pi: string[]): NameVerdict {
  const pairs: [number, number, number][] = []
  h.forEach((x, i) => p.forEach((y, j) => {
    const s = tokenSim(x, y)
    if (s > 0) pairs.push([s, i, j])
  }))
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2])
  const hUsed = new Set<number>()
  const pUsed = new Set<number>()
  let sum = 0
  for (const [s, i, j] of pairs) {
    if (hUsed.has(i) || pUsed.has(j)) continue
    hUsed.add(i)
    pUsed.add(j)
    sum += s
  }
  const m = hUsed.size
  const variant = pairs.some(([s, i, j]) => hUsed.has(i) && pUsed.has(j) && s < 1)
  const unH = h.filter((_, i) => !hUsed.has(i) && !WEAK.has(h[i]))
  let unP = p.filter((_, j) => !pUsed.has(j))
  // Initials must fit unmatched tokens on the other side.
  for (const [mine, theirs] of [[hi, unP], [pi, unH]] as const) {
    for (const ini of mine) {
      const starts = [ini, phoneticKey(ini)[0], ini === 'p' ? 'f' : ini]
      const k = theirs.findIndex((t) => starts.includes(t[0]))
      if (k === -1 && theirs.length) return { verdict: 'mismatch', score: 0, reason: 'initial_conflict', variant }
      if (k !== -1) (theirs as string[]).splice(k, 1)
    }
  }
  unP = unP.filter((t) => !WEAK.has(t))
  const score = m ? sum / Math.max(m, Math.min(h.length, p.length)) : 0
  if (m === 0) return { verdict: 'mismatch', score: 0, reason: 'name_mismatch', variant }
  if (unH.length && unP.length) return { verdict: 'mismatch', score, reason: 'name_mismatch', variant }
  const strongP = p.filter((t) => !WEAK.has(t)).length
  // One name in common is not enough when the other side has more: "Mr. SHETTY" against "R. V. Shetty" names no person
  // (the patient's initials count as name parts; header initials that fit them do settle it).
  if (m < 2 && (strongP >= 2 || (strongP + pi.length >= 2 && !hi.length))) return { verdict: 'insufficient', score, reason: 'single_name_token', variant }
  return { verdict: 'match', score, variant }
}

/** Compares a header name with one patient name. */
export function compareNames(headerName: string, patientName: string): NameVerdict {
  const h = normaliseName(headerName)
  const p = normaliseName(patientName)
  if (!h.tokens.length) return { verdict: 'insufficient', score: 0, reason: h.initials.length ? 'name_initials_only' : 'name_missing', variant: false }
  const rank = { match: 2, insufficient: 1, mismatch: 0 }
  let best: NameVerdict | null = null
  for (const hv of variants(h.tokens))
    for (const pv of variants(p.tokens)) {
      const r = compareTokens(hv, h.initials, pv, p.initials)
      if (!best || rank[r.verdict] > rank[best.verdict] || (rank[r.verdict] === rank[best.verdict] && r.score > best.score)) best = r
    }
  const plainSame = h.plain.join(' ') === p.plain.join(' ')
  return { ...best!, variant: best!.verdict === 'match' && !plainSame }
}

// ---------- age / sex / mrn ----------

/** Header age in years. "52 Y", "52Yrs", "52 years 3 months", "6 M", "15 D", "52 वर्ष", 52. */
export function parseAge(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null
  const s = raw.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966)).toLowerCase()
  const m = s.match(/(\d{1,3}(?:\.\d+)?)\s*(y(?:ea)?r?s?\.?|years?|वर्ष|साल|m(?:o|th|nth|onths?)?s?\.?|महीने|माह|d(?:ays?)?\.?|दिन|w(?:ee)?ks?\.?)?/u)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2] ?? 'y'
  // ponytail: a bare "M" after ≥ 24 is read as years ("52 M" is usually age 52, sex M); explicit "mths" is months.
  if (/^m\.?$/.test(unit) && n >= 24) return n
  if (/^(m|महीने|माह)/u.test(unit)) return n / 12
  if (/^(d|दिन)/u.test(unit)) return n / 365
  if (/^w/.test(unit)) return n / 52
  return n
}

/** 'M' | 'F' | 'O' | null from "M", "Male", "F", "Female", "पुरुष", "महिला", "स्त्री", "Other", "TG". */
export function normaliseSex(raw: string | null | undefined): 'M' | 'F' | 'O' | null {
  if (!raw) return null
  const s = raw.normalize('NFC').trim().toLowerCase().replace(/[.\s]/g, '')
  if (['m', 'male', 'man', 'boy', 'पुरुष', 'पु', 'नर'].includes(s)) return 'M'
  if (['f', 'female', 'woman', 'girl', 'महिला', 'स्त्री', 'मा', 'औरत'].includes(s)) return 'F'
  if (['o', 'other', 'others', 't', 'tg', 'transgender', 'अन्य', 'किन्नर'].includes(s)) return 'O'
  return null
}

const normMrn = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')

/** Whole years between dob and date. */
export function ageOn(dob: string, date: string): number {
  let age = +date.slice(0, 4) - +dob.slice(0, 4)
  if (date.slice(5) < dob.slice(5)) age--
  return age
}

// ---------- decision ----------

/**
 * Identity decision for one document header vs the patient (FR-ID-04).
 * mismatch: name conflict, sex conflict, DOB conflict, or age differs by > 1 year at the report date.
 * insufficient: no name, initials only, a single name token, "Baby of", or nothing to corroborate the name
 * (age/DOB at report date or an equal MRN). match: name matches (alias/transliteration-aware) and is corroborated.
 */
export function decideIdentity(patient: PatientIdentity, header: HeaderIdentity, reportDate: string | null): IdentityDecision {
  const reasons: string[] = []
  const notes: string[] = []
  const hard: string[] = []
  let corroborated = false

  // Name
  let score = 0
  let nameVerdict: 'match' | 'mismatch' | 'insufficient' = 'insufficient'
  const headerName = (header.name ?? '').trim()
  if (!headerName) reasons.push('name_missing')
  else if (normaliseName(headerName).babyOf) reasons.push('baby_of_clause')
  else {
    const candidates = [patient.name, ...(patient.aliases ?? [])].map((n, i) => ({ ...compareNames(headerName, n), alias: i > 0 }))
    const rank = { match: 2, insufficient: 1, mismatch: 0 }
    const best = candidates.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] || (rank[b.verdict] === rank[a.verdict] && b.score > a.score) ? b : a))
    score = best.score
    nameVerdict = best.verdict
    if (best.verdict === 'mismatch') hard.push(best.reason ?? 'name_mismatch')
    else if (best.verdict === 'insufficient') reasons.push(best.reason ?? 'name_insufficient')
    else {
      if (best.alias) notes.push('matched_on_alias')
      if (best.variant) notes.push('transliteration_variant')
    }
  }

  // Sex
  const hs = normaliseSex(header.sex)
  const ps = normaliseSex(patient.sex)
  if (hs && ps && hs !== ps) hard.push('sex_mismatch')
  if (!hs) notes.push('sex_not_stated')

  // DOB / age
  if (header.dob) {
    const d = parseDate(header.dob)
    if (!patient.dob) notes.push('patient_dob_unknown')
    else if (d.iso && d.precision === 'day') {
      if (d.iso === patient.dob) corroborated = true
      else if (d.alternatives?.includes(patient.dob)) {
        corroborated = true
        notes.push('dob_ambiguous_reading')
      } else hard.push('dob_mismatch')
    }
  }
  const age = parseAge(header.age)
  if (age !== null) {
    if (!patient.dob) notes.push('patient_dob_unknown')
    else if (!reportDate) notes.push('age_not_compared_no_report_date')
    else {
      const actual = ageOn(patient.dob, reportDate)
      const diff = age >= 1 ? Math.abs(Math.floor(age) - actual) : Math.abs(age - daysBetween(patient.dob, reportDate) / 365.25)
      if (diff > 1) hard.push('age_mismatch')
      else corroborated = true
    }
  }

  // MRN (supportive only)
  if (header.mrn && patient.mrns?.length) {
    if (patient.mrns.some((m) => normMrn(m) === normMrn(header.mrn!))) {
      notes.push('mrn_match')
      corroborated = true
    } else notes.push('mrn_differs')
  }

  const uniq = (xs: string[]) => [...new Set(xs)]
  if (hard.length) return { result: 'mismatch', score, reasons: uniq([...hard, ...reasons]), notes: uniq(notes) }
  if (nameVerdict !== 'match') return { result: 'insufficient', score, reasons: uniq(reasons), notes: uniq(notes) }
  if (!corroborated) return { result: 'insufficient', score, reasons: ['no_corroborating_field'], notes: uniq(notes) }
  return { result: 'match', score, reasons: [], notes: uniq(notes) }
}
