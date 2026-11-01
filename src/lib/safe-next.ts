// `?next=` on /p/login: honoured only as a same-origin path inside the patient portal. Anything else is dropped,
// so the login page can never be used as an open redirect.
const BASE = 'http://portal.invalid'

export function safePortalNext(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string' || v.length > 200) return null
  if (!/^\/p(?:[/?]|$)/.test(v)) return null // starts with /p: never a scheme, a bare host, or another area
  if (v.includes('//') || /[\\\u0000-\u001f\u007f]/.test(v)) return null
  let u: URL
  try { u = new URL(v, BASE) } catch { return null }
  if (u.origin !== BASE || !/^\/p(?:\/|$)/.test(u.pathname)) return null // e.g. /p/../admin resolves out of the portal
  return u.pathname + u.search
}
