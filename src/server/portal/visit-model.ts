// Pre-visit questions (FR-VOX-01): the answer model, validation, the read-back builder (FR-VOX-04) and the
// mapping of answers to the fields the Radar reads. Pure and client-safe: the browser builds the read-back it
// shows, and the server rebuilds the identical text from the same answers before storing it.
import { z } from 'zod'
import { formatDateIN } from '@/core/copy'
import type { Lang } from '@/core/types'
import { tp, type PatientKey } from '@/i18n/patient'

/** The five questions, in order. FR-VOX-01 says "configurable": edit this list (ids must match StatementQuestion). */
export const QUESTIONS = [
  { id: 'other_hospital', placeKey: 'f_place_hospital' },
  { id: 'new_medicines', placeKey: 'f_place_prescriber' },
  { id: 'new_tests', placeKey: 'f_place_test' },
  { id: 'admissions', placeKey: 'f_place_admission' },
  { id: 'anything_else', placeKey: null },
] as const satisfies readonly { id: string; placeKey: PatientKey | null }[]

export type QuestionId = (typeof QUESTIONS)[number]['id']
export const QUESTION_IDS = QUESTIONS.map((q) => q.id) as QuestionId[]
export const TEST_KINDS = ['blood', 'scan', 'sample', 'other'] as const
export type TestKind = (typeof TEST_KINDS)[number]

const text = (max: number) => z.string().trim().max(max).optional()

export const answerSchema = z.object({
  yn: z.enum(['yes', 'no', 'unsure']),
  /** Hospital / doctor name (typed or voice), verbatim. */
  place: text(200),
  /** Medicine names (new_medicines) or test name (new_tests), verbatim. */
  names: text(400),
  testKind: z.enum(TEST_KINDS).optional(),
  /** Absolute date parts. Month needs a year. */
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  /** Relative or vague time in the patient's own words ("3 weeks back"): kept verbatim, never turned into a date (E-DOC-13). */
  whenText: text(120),
  /** anything_else: the patient's own words (FR-VOX-07). */
  free: text(2000),
  /** Any field of this answer was filled with voice typing. */
  voice: z.boolean().optional(),
  /** Sarvam recordings behind this answer (voice_clips ids, FR-VOX-05); kept beside the statement. */
  clips: z.array(z.uuid()).max(6).optional(),
}).refine((a) => a.month == null || a.year != null, { message: 'month needs a year', path: ['month'] })

export type Answer = z.infer<typeof answerSchema>
export type Answers = Partial<Record<QuestionId, Answer>>

export const answersSchema = z.object(
  Object.fromEntries(QUESTION_IDS.map((q) => [q, answerSchema.optional()])) as Record<QuestionId, z.ZodOptional<typeof answerSchema>>,
).superRefine((all, ctx) => {
  for (const q of QUESTION_IDS.slice(0, 4)) if (!all[q]) ctx.addIssue({ code: 'custom', path: [q], message: 'answer required' })
  const e = all.anything_else
  if (e?.yn === 'yes' && !(e.free ?? '').trim()) ctx.addIssue({ code: 'custom', path: ['anything_else', 'free'], message: 'words required' })
})

const clean = (s: string | undefined) => (s ?? '').trim()

/** "Mar 2026" / "मार्च 2026" / "2026"; null when no year was given. */
export function monthYear(a: Answer, lang: Lang): string | null {
  if (a.year == null) return null
  return a.month != null ? formatDateIN(`${a.year}-${String(a.month).padStart(2, '0')}-01`, lang, 'month') : String(a.year)
}

/** The "when" words for the read-back: the absolute month/year and/or the patient's own phrase in quotes. */
export function whenLabel(a: Answer, lang: Lang): string | null {
  const parts = [monthYear(a, lang), clean(a.whenText) ? `“${clean(a.whenText)}”` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Absolute date the patient gave, for the Radar window. Month precision → 1st of month; year → 1 Jan. */
export function statedDate(a: Answer): { iso: string; precision: 'month' | 'year' } | null {
  if (a.year == null) return null
  return a.month != null
    ? { iso: `${a.year}-${String(a.month).padStart(2, '0')}-01`, precision: 'month' }
    : { iso: `${a.year}-01-01`, precision: 'year' }
}

/** Medicine names split on commas / semicolons / line breaks, each kept verbatim. */
export const splitNames = (s: string | undefined) => clean(s).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)

/** Does this answer carry words or facts worth showing to the clinician (yes + details, or anything_else text)? */
export function hasContent(q: QuestionId, a: Answer): boolean {
  if (q === 'anything_else') return a.yn === 'yes' && clean(a.free).length > 0
  return a.yn === 'yes'
}

/** The words the patient gave, joined for the "transcript" column: typed parts verbatim, most important first, nothing added. */
export function transcriptOf(q: QuestionId, a: Answer, lang: Lang): string {
  if (q === 'anything_else') return a.yn === 'yes' ? clean(a.free) : tp(lang, a.yn === 'no' ? 'no' : 'unsure')
  const names = q === 'new_medicines' || q === 'new_tests' ? [clean(a.names)] : []
  const parts = [...names, clean(a.place), monthYear(a, lang), clean(a.whenText)].filter(Boolean)
  return parts.join('; ') || tp(lang, a.yn)
}

function details(q: QuestionId, a: Answer, lang: Lang): string {
  const when = whenLabel(a, lang)
  const parts: (string | null)[] = []
  switch (q) {
    case 'other_hospital': parts.push(clean(a.place), when); break
    case 'new_medicines': parts.push(clean(a.names), clean(a.place), when); break
    case 'new_tests':
      parts.push(a.testKind ? tp(lang, `kind_${a.testKind}` as PatientKey) : null, clean(a.names), clean(a.place), when)
      break
    case 'admissions': parts.push(clean(a.place), when); break
    case 'anything_else': parts.push(clean(a.free)); break
  }
  return parts.filter(Boolean).join(', ')
}

export type Readback = { intro: string; lines: { q: QuestionId; text: string }[] }

/**
 * What the system understood, as plain sentences in the chosen language (FR-VOX-04). Wording comes only from the
 * i18n catalogue; the patient's own words are passed through verbatim, nothing is interpreted or classified.
 */
export function buildReadback(answers: Answers, lang: Lang): Readback {
  const lines: Readback['lines'] = []
  for (const q of QUESTION_IDS) {
    const a = answers[q]
    if (!a) continue
    let key: string
    let d = ''
    if (q === 'anything_else') {
      d = a.yn === 'yes' ? clean(a.free) : ''
      key = d ? 'rb_anything_else_yes' : 'rb_anything_else_no'
    } else if (a.yn === 'yes') {
      d = details(q, a, lang)
      key = d ? `rb_${q}_yes` : `rb_${q}_yes_plain`
    } else key = `rb_${q}_${a.yn}`
    // the sentence supplies its own full stop: "…subah shaam." from voice typing must not read "…subah shaam.."
    lines.push({ q, text: tp(lang, key as PatientKey, { details: d.replace(/[\s.।!?]+$/u, '') }) })
  }
  return { intro: tp(lang, 'reviewIntro'), lines }
}

/** A complete set: the first four need a tap; anything_else may be left out (blank = nothing to add). */
export function missingQuestion(answers: Answers): QuestionId | null {
  return QUESTION_IDS.slice(0, 4).find((q) => !answers[q]) ?? null
}
