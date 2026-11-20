// Plain words for the missing-papers checks, so an administrator never reads a rule id, a field name or a raw placeholder. Pure.
const words = (s: string) => s.replace(/_/g, ' ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A short title from what the check looks for and what starts it, e.g. "Histopathology report after procedure documented". */
export function ruleTitle(r: { expects: { document_types: readonly string[]; window_days: readonly [number, number] }; trigger: { event_type: string } }): string {
  const what = r.expects.document_types.map(words).join(' or ')
  const [from, to] = r.expects.window_days
  const when = to <= 0 ? 'after' : from >= 0 ? 'before' : 'around'
  return cap(`${what} ${when} ${words(r.trigger.event_type)}`)
}

const day = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`
const span = (n: number) => { const d = Math.abs(n); return d >= 365 && d % 365 === 0 ? `${d / 365} ${d / 365 === 1 ? 'year' : 'years'}` : day(n) }

/** "-3650 to 0" is "from 10 years before to the day itself". The window is measured from the trigger date. */
export function windowText([from, to]: readonly [number, number]): string {
  const side = (n: number) => (n === 0 ? 'the day itself' : `${span(n)} ${n < 0 ? 'before' : 'after'}`)
  return from === to ? side(from) : `From ${side(from)} to ${side(to)}`
}

/** Fills the placeholders with a sample so the wording reads as staff will see it. */
export function sampleWording(text: string): string {
  return text
    .replace(/\{event_date\}/g, '12 Oct 2026').replace(/\{source_label\}/g, 'discharge summary').replace(/\{test\}/g, 'the named test')
    .replace(/\{scan\}/g, 'the scan').replace(/\{institution\}/g, 'the hospital').replace(/\{missing_list\}/g, 'the papers listed')
}

/** The trigger's needed fields in words ("a procedure description and a date"). */
export function neededFields(fields: readonly string[]): string {
  const f = fields.map((x) => (x === 'event_date' ? 'a date' : `the ${words(x).replace(/ text$/, '')}`))
  return f.length > 1 ? `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}` : f[0] ?? ''
}
