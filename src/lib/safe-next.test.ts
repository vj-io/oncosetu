import { describe, expect, it } from 'vitest'
import { safePortalNext } from './safe-next'

describe('safePortalNext (open-redirect guard for /p/login?next=)', () => {
  it('accepts same-origin portal paths', () => {
    expect(safePortalNext('/p')).toBe('/p')
    expect(safePortalNext('/p/visit')).toBe('/p/visit')
    expect(safePortalNext('/p/requests?lang=hi')).toBe('/p/requests?lang=hi')
    expect(safePortalNext(['/p/visit', '/evil'])).toBe('/p/visit') // first value wins
  })
  it('rejects absolute URLs, scheme tricks and protocol-relative paths', () => {
    for (const v of [
      'https://evil.example/p/visit', 'http://evil.example', '//evil.example/p', '/\\evil.example', '/p//evil.example',
      'javascript:alert(1)', 'data:text/html,x', '\\\\evil.example', ' /p/visit', '/p/visit\n', '/p/vi\tsit', '/p\\..\\admin',
    ]) expect(safePortalNext(v), v).toBeNull()
  })
  it('rejects other areas of the app and portal-lookalikes', () => {
    for (const v of ['/', '/admin', '/patients/1', '/pizza', '/p-evil', '/api/auth/staff/login', 'p/visit', '']) expect(safePortalNext(v), v).toBeNull()
  })
  it('rejects paths that resolve out of the portal', () => {
    expect(safePortalNext('/p/../admin')).toBeNull()
    expect(safePortalNext('/p/%2e%2e/admin')).toBeNull()
  })
  it('rejects missing and oversized input', () => {
    expect(safePortalNext(undefined)).toBeNull()
    expect(safePortalNext(null)).toBeNull()
    expect(safePortalNext([])).toBeNull()
    expect(safePortalNext('/p/' + 'a'.repeat(300))).toBeNull()
  })
})
