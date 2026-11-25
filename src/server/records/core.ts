// "All records": the pure rules for one patient's papers in date order, the filters, scan-to-report pairing and earlier
// studies. Nothing here reads a picture. Pairing and "earlier study" use dates, header words and the report's own words only,
// and a pair is only ever *possible* until a person confirms it. No server or database imports, so a browser bundle may use it.

import { findDates, parseDate } from '@/core/dates'

export type RecordKind = 'report' | 'scan' | 'lab' | 'rx' | 'other'
export const KIND_LABEL: Record<RecordKind, string> = { report: 'Reports', scan: 'Scans', lab: 'Labs', rx: 'Prescriptions', other: 'Other' }
export const KIND_ORDER: RecordKind[] = ['report', 'scan', 'lab', 'rx', 'other']

export type ModalityKey = 'CT' | 'MR' | 'PET-CT' | 'XR' | 'MG' | 'US' | 'NM' | 'OTHER'
export const MODALITY_LABEL: Record<ModalityKey, string> = {
  CT: 'CT', MR: 'MRI', 'PET-CT': 'PET-CT', XR: 'X-ray', MG: 'Mammogram', US: 'Ultrasound', NM: 'Nuclear scan', OTHER: 'Other',
}

export type ScanInfo = {
  modality: ModalityKey
  /** The study word the file's header gives ("PET-CT", "CT scan"). */
  label: string
  bodyPart: string | null
  bodyKey: string | null
  studyDate: string | null
  description: string | null
  instances: number
  frames: number
  synthetic: boolean
  institution: string | null
  patientName: string | null
  patientSex: string | null
  patientAge: string | null
  rawModality: string | null
  /** The study's own identifier from the header; parts of one study uploaded separately share it. */
  studyUid: string | null
  /** When a study came in several uploads: how many parts are merged into this row. */
  parts?: number
}

export type RecordRow = {
  /** The row's own id: the document's id, or `<document id>.<n>` for report n of a file that holds several. */
  id: string
  /** The stored document (file) the row comes from: links, previews and actions use it. */
  docId: string
  /** One report of a file that holds several (E-DOC-10): its place in the file, its pages, and whether it is the file's newest. */
  section?: { n: number; of: number; pages: number[]; newest: boolean }
  /** Earlier studies this report says it was compared with (comparedDates), each linked to the paper on file of that date. */
  compared?: (Compared & { rowId: string | null })[]
  /** Later reports that say they were compared with this paper. */
  comparedBy?: string[]
  kind: RecordKind
  docType: string | null
  /** What a person calls it: "Imaging report", "CT chest". */
  title: string
  /** A short line copied from the paper's own words (first fact), never reworded. */
  asWritten: string | null
  institution: string | null
  /** The date the list is ordered by: the paper's own date, or the day it was received when the paper has none. */
  date: string | null
  dateFrom: 'paper' | 'received'
  receivedAt: string
  facts: number
  checked: number
  pages: number | null
  mime: string
  pageImages: number[]
  amendment: boolean
  lateReceived: boolean
  handwritten: boolean
  lowConfidence: boolean
  scan: ScanInfo | null
  /** For a written imaging report: the kinds of study its heading words name. Used only to bring reports into a scan-kind filter. */
  reportMods?: ModalityKey[]
}

// ── dates ────────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "28 Apr 2026" from an ISO date (day and month, never month first). */
export function fmtDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'date not stated'
}
/** "12 Feb 2025" for a day, "Dec 2025" for a month-only reference. */
export function fmtCompared(c: Compared): string {
  const m = /^(\d{4})-(\d{2})$/.exec(c.date)
  return c.month && m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : fmtDay(c.date)
}
const dayNo = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)
export const daysApart = (a: string, b: string) => Math.abs(dayNo(a) - dayNo(b))

// ── kinds and modalities ─────────────────────────────────────────────────────
const REPORT_TYPES = new Set(['pathology_report', 'ihc_molecular_report', 'imaging_report', 'discharge_summary', 'consult_note', 'chemo_daycare_record', 'radiotherapy_summary', 'procedure_note'])

export function modalityKey(modalities: readonly string[]): ModalityKey {
  const m = new Set(modalities.map((x) => x.toUpperCase()))
  if (m.has('PT')) return 'PET-CT'
  if (m.has('CT')) return 'CT'
  if (m.has('MR')) return 'MR'
  if (m.has('CR') || m.has('DX') || m.has('RF') || m.has('XA')) return 'XR'
  if (m.has('MG')) return 'MG'
  if (m.has('US')) return 'US'
  if (m.has('NM')) return m.has('CT') ? 'PET-CT' : 'NM'
  return 'OTHER'
}

const BODY_WORDS: [string, RegExp][] = [
  ['whole', /whole\s*-?\s*body|wholebody|skull\s+(base\s+)?to|vertex|total\s*body/i],
  ['chest', /chest|thora[cx]|lung|pulmon/i],
  ['abdomen', /abdom|pelvi|liver|hepat|renal|kidney/i],
  ['brain', /brain|head|cranial|cranium|skull/i],
  ['breast', /breast|mammo|axilla/i],
  ['spine', /spine|spinal|lumbar|cervical|vertebr/i],
  ['bone', /bone|skelet|extremit|limb|knee|hip\b|shoulder/i],
]
/** A short key for a body part word ("CHEST" → chest, "WHOLEBODY" → whole), or null when it says nothing usable. */
export function bodyKey(text: string | null | undefined): string | null {
  if (!text) return null
  return BODY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null
}
const BODY_TITLE: Record<string, string> = { whole: 'Whole body', chest: 'Chest', abdomen: 'Abdomen and pelvis', brain: 'Brain', breast: 'Breast', spine: 'Spine', bone: 'Bone' }
/** "Whole body" for "WHOLEBODY"; other words are title-cased as they are written. */
export function bodyLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const k = bodyKey(raw)
  if (k === 'whole') return BODY_TITLE.whole
  const t = raw.trim().toLowerCase().replace(/_/g, ' ')
  return t ? t[0].toUpperCase() + t.slice(1) : null
}

export type DocLike = {
  id: string; docType: string | null; mime: string; flags: Record<string, unknown>; documentDate: string | null; institutionName: string | null
  receivedAt: Date | string; pages: number | null; amendmentOf: string | null; handwritten: boolean | null; lowConfidence: boolean
}

type ImagingFlags = {
  modality?: string | null; modalities?: string[]; modalityLabel?: string; studyLabel?: string; studyDate?: string | null; bodyPart?: string | null
  studyDescription?: string | null; instances?: number; frames?: number; synthetic?: boolean; institution?: string | null
  patientName?: string | null; patientSex?: string | null; patientAge?: string | null; studyUid?: string | null
}

export function scanOf(d: Pick<DocLike, 'flags'>): ScanInfo | null {
  const im = d.flags.imaging as ImagingFlags | undefined
  if (!im || im.modality === 'ECG') return null
  const mods = im.modalities?.length ? im.modalities : im.modality ? [im.modality] : []
  return {
    modality: modalityKey(mods), label: String(im.studyLabel ?? im.modalityLabel ?? 'Imaging file'), bodyPart: bodyLabel(im.bodyPart), bodyKey: bodyKey(im.bodyPart),
    studyDate: im.studyDate ?? null, description: im.studyDescription ?? null, instances: Number(im.instances ?? 1), frames: Number(im.frames ?? 1),
    synthetic: !!im.synthetic, institution: im.institution ?? null, patientName: im.patientName ?? null, patientSex: im.patientSex ?? null,
    patientAge: im.patientAge ?? null, rawModality: im.modality ?? null, studyUid: im.studyUid ?? null,
  }
}

export function kindOf(d: DocLike): RecordKind {
  if (d.flags.consentForm) return 'other'
  if (scanOf(d)) return 'scan'
  const file = d.flags.file as { storedOnly?: boolean } | undefined
  if (file?.storedOnly) return 'other'
  if (d.docType === 'lab_report') return 'lab'
  if (d.docType === 'prescription_printed' || d.docType === 'prescription_handwritten') return 'rx'
  if (d.docType && REPORT_TYPES.has(d.docType)) return 'report'
  return 'other'
}

export function titleOf(d: DocLike, scan: ScanInfo | null, docLabel: (t: string) => string): string {
  if (d.flags.consentForm) return (d.flags.consentForm as { action?: string }).action === 'withdraw' ? 'Signed withdrawal of consent' : 'Signed consent form'
  if (scan) {
    const base = scan.modality === 'OTHER' ? scan.label : scan.modality === 'NM' ? 'Bone scan' : MODALITY_LABEL[scan.modality]
    return [base, scan.bodyPart && scan.modality !== 'MG' && !(scan.modality === 'NM' && /bone/i.test(scan.bodyPart)) ? scan.bodyPart.toLowerCase() : null].filter(Boolean).join(' ')
  }
  const file = d.flags.file as { label?: string; storedOnly?: boolean } | undefined
  if (file?.storedOnly) return `${file.label ?? 'File'}`
  return d.docType ? docLabel(d.docType) : 'Document'
}

const iso = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString())

export function toRecordRow(d: DocLike, o: { docLabel: (t: string) => string; facts: number; checked: number; pageImages: number[]; asWritten: string | null; lateReceived: boolean }): RecordRow {
  const scan = scanOf(d)
  const paper = scan?.studyDate ?? d.documentDate
  const received = iso(d.receivedAt)
  return {
    id: d.id, docId: d.id, kind: kindOf(d), docType: d.docType, title: titleOf(d, scan, o.docLabel), asWritten: o.asWritten,
    institution: d.institutionName ?? scan?.institution ?? null, date: paper ?? received.slice(0, 10), dateFrom: paper ? 'paper' : 'received', receivedAt: received,
    facts: o.facts, checked: o.checked, pages: d.pages, mime: d.mime, pageImages: o.pageImages, amendment: !!d.amendmentOf, lateReceived: o.lateReceived,
    handwritten: !!d.handwritten, lowConfidence: d.lowConfidence, scan,
  }
}

/**
 * Parts of one study that arrived in separate uploads (same StudyInstanceUID) are shown as ONE study: the part that arrived first
 * stands for it and the image counts add up. Each part counts the pictures the viewer steps through (its instances, or a single
 * file's frames), the same count the preview route uses (studyParts). The stored parts are untouched (originals are never changed).
 */
export function collapseStudyParts<T extends Pick<RecordRow, 'id' | 'scan' | 'receivedAt'>>(rows: readonly T[]): T[] {
  const byUid = new Map<string, T[]>()
  for (const r of rows) if (r.scan?.studyUid) byUid.set(r.scan.studyUid, [...(byUid.get(r.scan.studyUid) ?? []), r])
  const drop = new Set<string>(), rep = new Map<string, T>()
  for (const group of byUid.values()) {
    if (group.length < 2) continue
    const [first, ...rest] = [...group].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id < b.id ? -1 : 1))
    for (const r of rest) drop.add(r.id)
    const pictures = group.reduce((n, r) => n + Math.max(1, r.scan!.instances > 1 ? r.scan!.instances : r.scan!.frames), 0)
    rep.set(first.id, { ...first, scan: { ...first.scan!, instances: pictures, frames: pictures, parts: group.length } })
  }
  return rows.filter((r) => !drop.has(r.id)).map((r) => rep.get(r.id) ?? r)
}

// ── comparisons ──────────────────────────────────────────────────────────────
/** A study named before "dated": "the MRI dated 12 February 2025", "Previous scan dated 09/04/2025", "previous PET/CT dated 26/08/2025". */
const STUDY_DATED = /(?<![\p{L}])(?:scans?|stud(?:y|ies)|MRI|CT|PET(?:[\s/-]*CT)?|CECT|NCCT|USG|ultrasound|ultrasonography|X-?ray|mammogra(?:m|phy)|examination|imaging)(?![\p{L}])[^.\n]{0,24}?(?<![\p{L}])dated(?![\p{L}])/giu

/** A date an earlier study is referred to by: to the day (`YYYY-MM-DD`), or to the month (`YYYY-MM`) when only that is legible. */
export type Compared = { date: string; month: boolean }

/**
 * Earlier studies a report says it was compared with: the date written right after "dated" when a study is named before it
 * ("…smaller than on the MRI dated 12 February 2025"). The reference is kept as written; it never becomes the report's own
 * date (header.ts reads "Dated" as a label only at a line start or before a colon), and the report's own date is never one.
 */
export function comparedDates(text: string, now: string | Date, own: string | null): Compared[] {
  const out = new Map<string, Compared>()
  for (const m of text.matchAll(STUDY_DATED)) {
    const end = m.index + m[0].length
    const d = findDates(text.slice(end, end + 24)).find((x) => x.kind === 'absolute')
    const p = d ? parseDate(d.raw, { now, dayFirst: true }) : null
    if (!p?.iso || (p.precision !== 'day' && p.precision !== 'month')) continue
    const date = p.precision === 'day' ? p.iso : p.iso.slice(0, 7)
    if (date !== own) out.set(date, { date, month: p.precision === 'month' })
  }
  return [...out.values()]
}

/**
 * Links each report's comparisons to the papers on file: an imaging paper (report or scan) dated that day, a report first when
 * both are there; for a month, only when exactly one imaging paper falls in it. The earlier paper learns which reports name it.
 */
export function linkComparisons<T extends Pick<RecordRow, 'id' | 'kind' | 'docType' | 'date' | 'dateFrom'>>(
  rows: readonly T[], comparedOf: ReadonlyMap<string, Compared[]>,
): (T & Pick<RecordRow, 'compared' | 'comparedBy'>)[] {
  const imaging = rows.filter((r) => r.dateFrom === 'paper' && (r.kind === 'scan' || r.docType === 'imaging_report'))
  const by = new Map<string, string[]>()
  const linked = new Map<string, NonNullable<RecordRow['compared']>>()
  for (const [id, list] of comparedOf) {
    linked.set(id, list.map((c) => {
      const hits = imaging.filter((r) => r.id !== id && (c.month ? r.date?.startsWith(c.date) : r.date === c.date))
      const hit = c.month ? (hits.length === 1 ? hits[0] : null) : hits.find((r) => r.kind === 'report') ?? hits[0] ?? null
      if (hit) by.set(hit.id, [...(by.get(hit.id) ?? []), id])
      return { ...c, rowId: hit?.id ?? null }
    }))
  }
  return rows.map((r) => {
    const compared = linked.get(r.id), comparedBy = by.get(r.id)
    return compared?.length || comparedBy ? { ...r, ...(compared?.length ? { compared } : {}), ...(comparedBy ? { comparedBy } : {}) } : r
  })
}

/** One row per stored file, in the given order: a file split into reports is walked as one paper (by its first report here). */
export function filesOf<T extends Pick<RecordRow, 'id' | 'docId'>>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => !seen.has(r.docId) && !!seen.add(r.docId)).map((r) => ({ ...r, id: r.docId }))
}

// ── order and filters ────────────────────────────────────────────────────────
/** Document date first; ties by the day received, then id so the order never shuffles. */
export function sortRecords<T extends Pick<RecordRow, 'id' | 'date' | 'receivedAt'>>(rows: readonly T[], order: 'new' | 'old' = 'new'): T[] {
  const dir = order === 'new' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a.date ?? '', y = b.date ?? ''
    if (x !== y) return x < y ? -dir : dir
    if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -dir : dir
    return a.id < b.id ? -dir : dir
  })
}

export type RecordFilter = { kind?: RecordKind | 'all'; modality?: ModalityKey | 'any'; q?: string; /** With a kind of scan chosen, also keep the written imaging reports about that kind of study. */ withReports?: boolean }
export function filterRecords(rows: readonly RecordRow[], f: RecordFilter): RecordRow[] {
  const q = f.q?.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false
    if (f.modality && f.modality !== 'any' && r.scan?.modality !== f.modality && !(f.withReports && r.reportMods?.includes(f.modality))) return false
    if (q && ![r.title, r.institution, r.asWritten].some((x) => x?.toLowerCase().includes(q))) return false
    return true
  })
}

export function countsByKind(rows: readonly RecordRow[]): Record<RecordKind | 'all', number> {
  const out = { all: rows.length, report: 0, scan: 0, lab: 0, rx: 0, other: 0 }
  for (const r of rows) out[r.kind]++
  return out
}

export function modalitiesPresent(rows: readonly RecordRow[]): ModalityKey[] {
  const seen = new Set(rows.flatMap((r) => (r.scan ? [r.scan.modality] : [])))
  return (Object.keys(MODALITY_LABEL) as ModalityKey[]).filter((m) => seen.has(m))
}

/** Next/previous in a list; null at the ends. */
export function neighbours<T extends { id: string }>(rows: readonly T[], id: string): { prev: T | null; next: T | null; index: number } {
  const i = rows.findIndex((r) => r.id === id)
  return { prev: i > 0 ? rows[i - 1] : null, next: i >= 0 && i < rows.length - 1 ? rows[i + 1] : null, index: i }
}

// ── scan ↔ report pairing (proposed, never asserted) ─────────────────────────
export type ReportTerms = { modalities: Set<ModalityKey>; body: Set<string> }

const MOD_WORDS: [ModalityKey, RegExp][] = [
  ['PET-CT', /pet\s*[-/ ]?\s*ct|pet\s*scan|fdg|psma/i],
  ['MG', /mammogra|mammo\b/i],
  ['MR', /\bmri?\b|magnetic\s+resonance/i],
  ['US', /ultrasound|sonograph|\busg\b/i],
  ['NM', /bone\s+scan|scintigra|nuclear\s+medicine|spect/i],
  ['XR', /x\s*-?\s*ray|radiograph|\bcxr\b/i],
  ['CT', /\bct\b|computed\s+tomograph/i],
]

/** Which kind of study a written imaging report is about, from its own heading words (a PET-CT report is not also a CT report). */
export function reportTerms(text: string): ReportTerms {
  const head = text.slice(0, 700)
  const find = (s: string) => new Set(MOD_WORDS.filter(([, re]) => re.test(s)).map(([k]) => k))
  let modalities = find(head)
  if (!modalities.size) modalities = find(text.slice(0, 4000))
  if (modalities.has('PET-CT')) modalities = new Set<ModalityKey>(['PET-CT'])
  const body = new Set(BODY_WORDS.filter(([, re]) => re.test(head)).map(([k]) => k))
  return { modalities, body }
}

export type PairCandidate = { id: string; date: string | null; institution: string | null }
export type ScanCandidate = PairCandidate & { modality: ModalityKey; bodyKey: string | null }
export type ReportCandidate = PairCandidate & { terms: ReportTerms }
export type Pair = { scanId: string; reportId: string; reason: string; score: number }

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sameInstitution = (a: string | null, b: string | null) => !!norm(a) && !!norm(b) && (norm(a).includes(norm(b)) || norm(b).includes(norm(a)))
export const PAIR_DAYS = 3

/** Plain words for why a pair is proposed. */
export function reasonText(days: number, sameModality: boolean, hospital: boolean | 'differs'): string {
  const when = days === 0 ? 'same date' : `${days} day${days > 1 ? 's' : ''} apart`
  return [when, sameModality ? 'same kind of study' : null, hospital === 'differs' ? 'different hospital' : hospital ? 'same hospital' : null].filter(Boolean).join(', ')
}

/**
 * Proposes at most one report per scan and one scan per report: date within a few days, the same kind of study, and a body part
 * that does not disagree. Best match first. `blocked` holds "scanId|reportId" pairs a person said are not a match.
 */
export function proposePairs(scans: readonly ScanCandidate[], reports: readonly ReportCandidate[], blocked: ReadonlySet<string> = new Set()): Pair[] {
  const all: Pair[] = []
  for (const s of scans) {
    if (!s.date) continue
    for (const r of reports) {
      if (!r.date || blocked.has(`${s.id}|${r.id}`)) continue
      const days = daysApart(s.date, r.date)
      if (days > PAIR_DAYS) continue
      if (!r.terms.modalities.has(s.modality)) continue
      const rb = r.terms.body
      const bodyOk = !s.bodyKey || !rb.size || s.bodyKey === 'whole' || rb.has('whole') || rb.has(s.bodyKey)
      if (!bodyOk) continue
      const hosp = sameInstitution(s.institution, r.institution)
      const bodyHit = !!s.bodyKey && rb.has(s.bodyKey)
      all.push({ scanId: s.id, reportId: r.id, reason: reasonText(days, true, hosp ? true : norm(s.institution) && norm(r.institution) ? 'differs' : false), score: 10 - days * 3 + (hosp ? 2 : 0) + (bodyHit ? 1 : 0) })
    }
  }
  all.sort((a, b) => b.score - a.score || (a.scanId + a.reportId < b.scanId + b.reportId ? -1 : 1))
  const usedS = new Set<string>(), usedR = new Set<string>()
  const out: Pair[] = []
  for (const p of all) {
    if (usedS.has(p.scanId) || usedR.has(p.reportId)) continue
    usedS.add(p.scanId)
    usedR.add(p.reportId)
    out.push(p)
  }
  return out
}

export type StoredLink = { id: string; aId: string; bId: string; state: 'proposed' | 'confirmed' | 'rejected' }
export type ResolvedPair = { scanId: string; reportId: string; state: 'confirmed' | 'possible'; reason: string; linkId: string | null }

/**
 * What the screens show: every confirmed link, then the best proposals among papers that are not already in a confirmed pair
 * and not rejected. Proposals are worked out each time; only a person's decision is stored.
 */
export function resolvePairs(scans: readonly ScanCandidate[], reports: readonly ReportCandidate[], links: readonly StoredLink[]): ResolvedPair[] {
  const scanIds = new Set(scans.map((s) => s.id)), reportIds = new Set(reports.map((r) => r.id))
  const confirmed = links.filter((l) => l.state === 'confirmed' && scanIds.has(l.aId) && reportIds.has(l.bId))
  const out: ResolvedPair[] = confirmed.map((l) => ({ scanId: l.aId, reportId: l.bId, state: 'confirmed', reason: 'confirmed by a person', linkId: l.id }))
  const takenS = new Set(confirmed.map((l) => l.aId)), takenR = new Set(confirmed.map((l) => l.bId))
  const blocked = new Set(links.filter((l) => l.state === 'rejected').map((l) => `${l.aId}|${l.bId}`))
  for (const p of proposePairs(scans.filter((s) => !takenS.has(s.id)), reports.filter((r) => !takenR.has(r.id)), blocked)) {
    out.push({ scanId: p.scanId, reportId: p.reportId, state: 'possible', reason: p.reason, linkId: links.find((l) => l.aId === p.scanId && l.bId === p.reportId)?.id ?? null })
  }
  return out
}

// ── earlier studies of the same area (display only) ──────────────────────────
/**
 * Earlier scans of the same kind and the same body part (or when a body part is not written, the same kind), newest first.
 * Used only to show them side by side. Nothing is compared and no change is described.
 */
export function earlierStudies(rows: readonly RecordRow[], id: string, limit = 4): RecordRow[] {
  const me = rows.find((r) => r.id === id)
  if (!me?.scan || !me.date) return []
  return sortRecords(rows.filter((r) => {
    if (r.id === id || !r.scan || !r.date || r.date >= me.date!) return false
    if (r.scan.modality !== me.scan!.modality) return false
    return !r.scan.bodyKey || !me.scan!.bodyKey || r.scan.bodyKey === me.scan!.bodyKey
  }), 'new').slice(0, limit)
}

/**
 * Earlier scans of the same body part but a different kind of study (a breast mammogram beside a breast ultrasound), newest first.
 * Only shown; nothing is compared.
 */
export function otherAreaStudies(rows: readonly RecordRow[], id: string, limit = 4): RecordRow[] {
  const me = rows.find((r) => r.id === id)
  if (!me?.scan || !me.date || !me.scan.bodyKey || me.scan.bodyKey === 'whole') return []
  return sortRecords(rows.filter((r) => r.id !== id && !!r.scan && !!r.date && r.date < me.date! && r.scan.modality !== me.scan!.modality && r.scan.bodyKey === me.scan!.bodyKey), 'new').slice(0, limit)
}

/** A person said this scan and this report are not a pair. Kept so it can be shown and undone. */
export type RejectedPair = { scanId: string; reportId: string }

/**
 * What the lists show the moment a person decides, before the server's fresh copy arrives. Rejecting drops the pair and keeps it
 * undoable; confirming marks it linked; undoing forgets the rejection (the server offers the match again on refresh).
 */
export function applyLinkDecision(pairs: readonly ResolvedPair[], rejected: readonly RejectedPair[], d: { scanId: string; reportId: string; decision: 'confirm' | 'reject' | 'reset' }): { pairs: ResolvedPair[]; rejected: RejectedPair[] } {
  const same = (p: { scanId: string; reportId: string }) => p.scanId === d.scanId && p.reportId === d.reportId
  const others = pairs.filter((p) => !same(p))
  const rest = rejected.filter((p) => !same(p))
  if (d.decision === 'reject') return { pairs: others, rejected: [...rest, { scanId: d.scanId, reportId: d.reportId }] }
  if (d.decision === 'reset') return { pairs: [...pairs], rejected: rest }
  const prior = pairs.find(same)
  return { pairs: [...others, { scanId: d.scanId, reportId: d.reportId, state: 'confirmed', reason: 'confirmed by a person', linkId: prior?.linkId ?? null }], rejected: rest }
}

/**
 * One steady summary line per paper: of the candidate lines, the one whose source field ranks first, then the text itself, so the same
 * paper always shows the same words however its facts were created or checked.
 */
export function betterHeadline(a: { rank: number; text: string } | null, b: { rank: number; text: string }): { rank: number; text: string } {
  if (!a) return b
  return b.rank < a.rank || (b.rank === a.rank && b.text < a.text) ? b : a
}

/** Year of a row's date, for the year dividers. */
export const yearOf = (r: Pick<RecordRow, 'date'>) => (r.date ?? '').slice(0, 4) || 'Undated'
