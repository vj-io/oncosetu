// Public: a receiving doctor opens a share link (no account). Returns ciphertext + iv; decryption happens in the browser
// with the key from the URL fragment, which browsers never send to the server.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/server/http'
import { openShare } from '@/server/shares/shares'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = route({ auth: 'public', body: z.object({ passcode: z.string().max(64).optional() }) }, async ({ req, params, body }) => {
  const id = String(params.id)
  if (!UUID.test(id)) return NextResponse.json({ error: { code: 'not_found', message: 'This link was not found' } }, { status: 404 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
  const r = await openShare(id, body.passcode || undefined, { ip, userAgent: req.headers.get('user-agent') ?? '' })
  return NextResponse.json(r.body, { status: r.status })
})
