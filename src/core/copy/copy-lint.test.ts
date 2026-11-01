// Lints every patient-facing string catalogue in src/i18n/*.ts (FR-CON-07, FR-VOX-06).
// Passes with zero catalogues. Every string found anywhere in an exported value is treated as patient-facing.
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOC_TYPES } from '../types'
import { brandFor, lintText, patientDocLabel } from '.'

const I18N_DIR = fileURLToPath(new URL('../../i18n', import.meta.url))

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[], seen = new Set<unknown>()) {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out, seen))
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out, seen)
  }
}

describe('copy lint: patient-facing catalogues', () => {
  it('src/i18n/*.ts contain no diagnosis or radar-banned words', async () => {
    const files = existsSync(I18N_DIR) ? readdirSync(I18N_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')) : []
    const strings: { path: string; text: string }[] = []
    for (const f of files) {
      const mod = await import(pathToFileURL(join(I18N_DIR, f)).href)
      collectStrings(mod, f, strings)
    }
    const failures = strings.flatMap(({ path, text }) =>
      lintText(text, ['diagnosis', 'radar']).map((h) => `${path}: "${h.match}" (${h.ruleset}:${h.term})`),
    )
    expect(failures).toEqual([])
  })

  it('neutral document labels and the non-cleared brand are clean in both languages', () => {
    for (const d of DOC_TYPES) {
      for (const disclosure of ['not_cleared', 'unknown'] as const) {
        for (const lang of ['en', 'hi'] as const) {
          expect(lintText(patientDocLabel(d, disclosure, lang), ['diagnosis', 'radar'])).toEqual([])
        }
      }
    }
    expect(lintText(brandFor('unknown'), ['diagnosis'])).toEqual([])
    expect(lintText(brandFor('cleared'), ['diagnosis']).length).toBeGreaterThan(0)
  })
})
