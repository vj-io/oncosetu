import { describe, expect, it } from 'vitest'
import { isPatientHost, patientOrigin } from './patient-origin'

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

describe('isPatientHost', () => {
  const NEUTRAL = 'https://setu-records.vercel.app'
  it('is true only for the configured neutral host, in any letter case', () => {
    expect(isPatientHost('setu-records.vercel.app', NEUTRAL)).toBe(true)
    expect(isPatientHost('Setu-Records.vercel.app', NEUTRAL)).toBe(true)
    for (const other of ['oncosetu-pilot.vercel.app', 'setu-records.vercel.app.evil.test', 'localhost:3000', '', null, undefined]) {
      expect(isPatientHost(other, NEUTRAL)).toBe(false)
    }
  })
  it('is false everywhere when no valid neutral address is configured', () => {
    for (const bad of [undefined, '', 'setu-records.vercel.app', 'http://setu-records.vercel.app']) {
      expect(isPatientHost('setu-records.vercel.app', bad)).toBe(false)
    }
  })
})
