// FR-CON-01: the consent notice has every entry in every notice language, and the Marathi stays neutral (FR-CON-07).
import { describe, expect, it } from 'vitest'
import { lintText } from '@/core/copy'
import { CONSENT_LANGS, consentCopy } from './consent'

/** Every { en, hi, … } entry of the catalogue, with its path. */
const entries = (v: object, path = ''): [string, Record<string, string>][] =>
  'en' in v ? [[path, v as Record<string, string>]] : Object.entries(v).flatMap(([k, x]) => entries(x, path ? `${path}.${k}` : k))

describe('consent notice catalogue', () => {
  it('has the same entries in English, Hindi, Hinglish and Marathi', () => {
    const all = entries(consentCopy)
    expect(all.map(([p]) => p)).toContain('metrics.detail')
    for (const [path, entry] of all) {
      expect(`${path}: ${Object.keys(entry).sort()}`).toBe(`${path}: ${[...CONSENT_LANGS].sort()}`)
      for (const l of CONSENT_LANGS) expect(entry[l].trim(), `${path}.${l}`).not.toBe('')
    }
  })

  it('has Marathi in Devanagari, free of diagnosis and Radar words', () => {
    for (const [path, entry] of entries(consentCopy)) {
      expect(entry.mr, path).toMatch(/[ऀ-ॿ]/)
      expect(lintText(entry.mr, ['diagnosis', 'radar']), path).toEqual([])
    }
  })
})
