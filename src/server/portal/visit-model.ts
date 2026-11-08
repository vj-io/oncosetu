// Pre-visit questions (FR-VOX-01): the answer model, validation, the read-back builder (FR-VOX-04) and the
// mapping of answers to the fields the Radar reads. Pure and client-safe: the browser builds the read-back it
// shows, and the server rebuilds the identical text from the same answers before storing it.
import { z } from 'zod'
import { formatDateIN } from '@/core/copy'
import type { Lang } from '@/core/types'
import { tp, type PatientKey } from '@/i18n/patient'

/** The five questions in their default order (ids must match StatementQuestion). An org switches them off and reorders them on /admin/settings (FR-VOX-01). */
export const QUESTIONS = [
  { id: 'other_hospital', placeKey: 'f_place_hospital' },
  { id: 'new_medicines', placeKey: 'f_place_prescriber' },
  { id: 'new_tests', placeKey: 'f_place_test' },
  { id: 'admissions', placeKey: 'f_place_admission' },
  { id: 'anything_else', placeKey: null },
] as const satisfies readonly { id: string; placeKey: PatientKey | null }[]

export type QuestionId = (typeof QUESTIONS)[number]['id']
export const QUESTION_IDS = QUESTIONS.map((q) => q.id) as QuestionId[]

/** The org setting (org_settings.flags.questions): every question with on/off, in the order asked. */
export type QuestionSetting = { id: string; on: boolean }
const isQuestion = (id: string): id is QuestionId => (QUESTION_IDS as string[]).includes(id)

/** All five questions in the org's order with on/off. No setting → the default order, all on; a question the setting omits is on, at the end. */
export function questionSettings(setting?: readonly QuestionSetting[] | null): { id: QuestionId; on: boolean }[] {
  const known = (setting ?? []).filter((x, i, all) => isQuestion(x.id) && all.findIndex((y) => y.id === x.id) === i)
  return [...known.map((x) => ({ id: x.id as QuestionId, on: x.on })), ...QUESTION_IDS.filter((q) => !known.some((x) => x.id === q)).map((id) => ({ id, on: true }))]
}

/** The questions an org asks, in its order (all five if a setting would switch every one off). */
export function enabledQuestions(setting?: readonly QuestionSetting[] | null): QuestionId[] {
  const ids = questionSettings(setting).filter((x) => x.on).map((x) => x.id)
  return ids.length ? ids : [...QUESTION_IDS]
}

/** The "first four need a tap" rule, for the questions actually asked: every enabled one except anything_else. */
export const requiredQuestions = (enabled: readonly QuestionId[]) => enabled.filter((q) => q !== 'anything_else')
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
  /** Voice shadow mode (FR-VOX-03): sealed tokens (clip id + what Sarvam heard) the browser cannot read; never the answer. */
  shadow: z.array(z.string().max(8000)).max(6).optional(),
}).refine((a) => a.month == null || a.year != null, { message: 'month needs a year', path: ['month'] })

export type Answer = z.infer<typeof answerSchema>
export type Answers = Partial<Record<QuestionId, Answer>>

const answersShape = z.object(
  Object.fromEntries(QUESTION_IDS.map((q) => [q, answerSchema.optional()])) as Record<QuestionId, z.ZodOptional<typeof answerSchema>>,
)

/** Answers to the questions an org asks: each enabled question but anything_else needs a tap. `[]` checks the shape only. */
export const answersFor = (enabled: readonly QuestionId[]) => answersShape.superRefine((all, ctx) => {
  for (const q of requiredQuestions(enabled)) if (!all[q]) ctx.addIssue({ code: 'custom', path: [q], message: 'answer required' })
  const e = all.anything_else
  if (e?.yn === 'yes' && !(e.free ?? '').trim()) ctx.addIssue({ code: 'custom', path: ['anything_else', 'free'], message: 'words required' })
})

/** All five asked (the default set). */
export const answersSchema = answersFor(QUESTION_IDS)

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
export function buildReadback(answers: Answers, lang: Lang, order: readonly QuestionId[] = QUESTION_IDS): Readback {
  const lines: Readback['lines'] = []
  for (const q of order) {
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

/** A complete set: every enabled question but anything_else needs a tap; anything_else may be left out (blank = nothing to add). */
export function missingQuestion(answers: Answers, enabled: readonly QuestionId[] = QUESTION_IDS): QuestionId | null {
  return requiredQuestions(enabled).find((q) => !answers[q]) ?? null
}
