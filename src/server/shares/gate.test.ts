import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { afterWrong, MAX_ATTEMPTS, openGate, type LinkState } from './gate'

const now = new Date('2026-11-02T06:00:00Z')
const link = (over: Partial<LinkState> = {}): LinkState => ({ revokedAt: null, expiresAt: new Date(+now + 86_400_000), lockedAt: null, hasPasscode: true, ...over })

describe('share open rules (FR-PAS-02, E-PAS-01/02, FR-CON-04)', () => {
  it('expired, revoked or consent withdrawn → gone (checked on use)', () => {
    expect(openGate(link({ expiresAt: now }), now, true, true)).toBe('gone_expired')
    expect(openGate(link({ revokedAt: now }), now, true, true)).toBe('gone_revoked')
    expect(openGate(link(), now, false, true)).toBe('gone_unavailable')
    expect(openGate(link({ revokedAt: now, lockedAt: now }), now, true, true)).toBe('gone_revoked') // gone wins over locked
  })

  it('locked links stay locked even with the right passcode', () => {
    expect(openGate(link({ lockedAt: now }), now, true, true)).toBe('locked')
  })

  it('passcode on: asks first (not an attempt), then checks', () => {
    expect(openGate(link(), now, true, false)).toBe('passcode_required')
    expect(openGate(link(), now, true, true)).toBe('check_passcode')
    expect(openGate(link({ hasPasscode: false }), now, true, false)).toBe('open')
  })

  it('locks on the 5th wrong passcode', () => {
    expect(MAX_ATTEMPTS).toBe(5)
    expect([1, 2, 3, 4].map((n) => afterWrong(n))).toEqual([4, 3, 2, 1].map((left) => ({ locked: false, left })))
    expect(afterWrong(5)).toEqual({ locked: true, left: 0 })
    expect(afterWrong(9).locked).toBe(true)
  })
})

// FR-PAS-02: the AES key lives in the URL fragment. Browsers never send a fragment, and no server code may try to read one.
describe('the server never receives the share key', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : []
  })
  const server = [...files(join(root, 'server/shares')), ...files(join(root, 'app/api/shares')), ...files(join(root, 'app/api/p/share-payload')), ...files(join(root, 'app/api/patients/[id]/share-payload'))]

  it('share route handlers and server code never touch a fragment or a key field', () => {
    expect(server.length).toBeGreaterThanOrEqual(7)
    for (const f of server) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/location\.hash|\.hash\b|importKey|exportKey|\bkey:\s*z\./)
    }
  })

  it('the create body is strict, so a key sent by mistake is rejected rather than stored', () => {
    const src = readFileSync(join(root, 'app/api/shares/route.ts'), 'utf8')
    expect(src).toMatch(/z\.strictObject\(/)
  })
})
