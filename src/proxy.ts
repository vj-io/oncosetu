// Security headers + nonce-based CSP on every response (Next 16 Proxy; see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
// Pages must render dynamically for Next to stamp the nonce on its scripts.
import { NextResponse, type NextRequest } from 'next/server'
import { isPatientHost } from '@/lib/patient-origin'

export function proxy(request: NextRequest) {
  // The neutral patient address never shows the branded home page (FR-CON-07): the printed patient guide gives the bare
  // address, and a patient who has not been told the diagnosis must land on patient sign-in, not on the product's front page.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
  if (request.nextUrl.pathname === '/' && isPatientHost(host)) {
    const to = request.nextUrl.clone()
    to.pathname = '/p/login'
    return NextResponse.redirect(to)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const dev = process.env.NODE_ENV === 'development'
  // A production build served over plain http on this machine (E2E): WebKit applies upgrade-insecure-requests to localhost
  // too and sends the page's own scripts to https://, which has no listener. Deployed hosts always get the directive.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(request.nextUrl.hostname)
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(dev || local ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  // Decrypted originals: sandboxed, nothing executes even if opened directly (PDF JavaScript, SVG, HTML smuggling).
  const fileRoute = /^\/api\/documents\/[^/]+\/file$/.test(request.nextUrl.pathname)
  res.headers.set('Content-Security-Policy', fileRoute ? `sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; frame-ancestors 'none'` : csp)
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'no-referrer') // share links carry the key in the URL fragment
  res.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
