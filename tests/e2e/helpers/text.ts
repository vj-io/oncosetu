// Copy checks on patient-facing text (FR-CON-07): no diagnosis words and no brand name containing "Onco" unless disclosure is cleared.
import { lintText } from '../../../src/core/copy/banned'

export const diagnosisHits = (text: string) => lintText(text, ['diagnosis']).map((h) => h.match)
/** Words that must not appear in administrative wording (Radar items, letters): needs, should, urgent, ... */
export const radarHits = (text: string) => lintText(text, ['radar']).map((h) => h.match)
export const legalHits = (text: string) => lintText(text, ['legal']).map((h) => h.match)
