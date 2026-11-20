// Copy checks on patient-facing text (FR-CON-07): no diagnosis words and no brand name containing "Onco" unless disclosure is cleared.
import { lintText } from '../../../src/core/copy/banned'

export const diagnosisHits = (text: string) => lintText(text, ['diagnosis']).map((h) => h.match)
/** Words that must not appear in administrative wording (Radar items, letters): needs, should, urgent, ... */
export const radarHits = (text: string) => lintText(text, ['radar']).map((h) => h.match)
export const legalHits = (text: string) => lintText(text, ['legal']).map((h) => h.match)
/**
 * What a section says, minus its buttons. 3a5338e named a records-officer control "Not needed" (set the item aside); that is a
 * control label, not wording about the patient, so the wording lint reads everything else.
 */
export const textWithoutButtons = (el: import('@playwright/test').Locator) =>
  el.evaluate((n) => { const c = n.cloneNode(true) as HTMLElement; c.querySelectorAll('button').forEach((b) => b.remove()); return c.textContent ?? '' })
