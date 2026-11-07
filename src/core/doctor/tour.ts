// The 2-minute tour for a first-time doctor: six steps over the two demo patients. Pure, so the order and links are tested.

export type TourPatients = { sunita: string | null; khan: string | null }

export type TourStep = {
  id: string
  /** Plain sentence the doctor reads. */
  text: string
  title: string
  /** Where this step takes place. Null when the patient could not be found (the step is skipped). */
  path: string | null
  /** data-tour attribute of the element to ring on that page (optional). */
  target?: string
  /** Ring this instead when the first target is not on the page. */
  fallback?: string
  patient: 'sunita' | 'khan'
}

export const TOUR_LENGTH = 6

export function tourSteps(p: TourPatients): TourStep[] {
  const at = (id: string | null, tab: string) => (id ? `/patients/${id}/${tab}` : null)
  return [
    { id: 'held', patient: 'sunita', title: 'A wrong-patient report is held', path: at(p.sunita, 'documents'), target: 'held', text: 'Sunita’s file holds a report that belongs to another patient. It is held, not filed, and nothing from it entered her record.' },
    { id: 'quote', patient: 'sunita', title: 'Every fact opens the exact words', path: at(p.sunita, 'documents'), target: 'held-card', fallback: 'documents', text: 'Open the discharge summary and click a fact. The original page opens with that sentence highlighted. Nothing is shown without its words.' },
    { id: 'missing', patient: 'sunita', title: 'Papers that are not in file', path: at(p.sunita, 'completeness'), target: 'missing-histopath', fallback: 'missing', text: 'The discharge summary mentions a histopathology report that is not in the file. One click makes a request letter for it.' },
    { id: 'letter', patient: 'sunita', title: 'A letter you can print', path: at(p.sunita, 'requests'), target: 'letter', text: 'Open a request and choose the letter. It prints in English or Hindi, addressed to the other hospital’s records department.' },
    { id: 'whatsnew', patient: 'khan', title: 'What changed since the last visit', path: at(p.khan, 'overview'), target: 'first-look', text: 'For Mr Khan the First look card says what is new since the visit sealed on 16 February, what is missing and what a person still has to check.' },
    { id: 'seal', patient: 'khan', title: 'Anyone can check the record is unchanged', path: at(p.khan, 'ledger'), target: 'seal', text: 'Open “Check the seal”. The public page confirms this record has not changed since it was sealed.' },
  ]
}

/** Steps whose patient was found. If neither demo patient exists the tour has nothing to show. */
export const usableSteps = (p: TourPatients) => tourSteps(p).filter((s) => s.path)

export type TourState = { active: boolean; step: number; patients: TourPatients }

export const clampStep = (step: number, total: number) => Math.min(Math.max(Math.trunc(step) || 0, 0), Math.max(total - 1, 0))

/** Parses what was saved in the browser; anything unexpected means "no tour running". */
export function parseTourState(raw: string | null): TourState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<TourState>
    if (typeof v.active !== 'boolean' || typeof v.step !== 'number' || !v.patients) return null
    const id = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null)
    return { active: v.active, step: clampStep(v.step, TOUR_LENGTH), patients: { sunita: id(v.patients.sunita), khan: id(v.patients.khan) } }
  } catch {
    return null
  }
}

export const TOUR_KEY = 'oncosetu.tour.v1'
export const TOUR_EVENT = 'oncosetu:tour-start'
