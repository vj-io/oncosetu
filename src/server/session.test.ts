import { describe, expect, it } from 'vitest'
import { cookieSecure } from './session'

describe('session cookie Secure flag', () => {
  it('is Secure on every deployed host, and on https whatever the host', () => {
    expect(cookieSecure('oncosetu-zeta.vercel.app', 'https', true)).toBe(true)
    expect(cookieSecure('oncosetu-zeta.vercel.app', null, true)).toBe(true)
    expect(cookieSecure('192.168.1.20:3000', 'http', true)).toBe(true)
    expect(cookieSecure('localhost:3100', 'https', true)).toBe(true)
  })
  it('drops Secure only for a plain-http production build on this machine, and in development', () => {
    for (const h of ['localhost:3100', '127.0.0.1:3305', '[::1]:3000', 'localhost']) expect(cookieSecure(h, 'http', true)).toBe(false)
    expect(cookieSecure('oncosetu-zeta.vercel.app', 'https', false)).toBe(false)
  })
})
