import { describe, expect, it } from 'vitest'
import { patientOrigin } from './patient-origin'

const OWN = 'https://oncosetu-pilot.vercel.app'

describe('patientOrigin', () => {
  it('uses the configured neutral address, without a trailing slash', () => {
    expect(patientOrigin(OWN, 'https://setu-records.vercel.app/')).toBe('https://setu-records.vercel.app')
  })
  it('falls back to the page origin when nothing or something unsafe is configured', () => {
    for (const bad of [undefined, '', '   ', 'setu-records.vercel.app', 'http://setu-records.vercel.app', 'https://x.app/p/login', 'javascript:alert(1)']) {
      expect(patientOrigin(OWN, bad)).toBe(OWN)
    }
  })
})
