// Postmark inbound webhook parsing (FR-ING-04). Pure: no DB, no env. Only what intake needs is read; the body text,
// HTML and subject are never kept.
import { z } from 'zod'
import { timingSafeEqualStr } from '../crypto'
import { MAX_FILE_BYTES } from '../pipeline/safety'
import { MAX_FILES } from './hold'

const addr = z.object({ Email: z.string().max(320) }).loose()
export const postmarkPayload = z.object({
  From: z.string().max(1000).optional(),
  FromFull: addr.optional(),
  To: z.string().max(10_000).optional(),
  ToFull: z.array(addr).max(100).optional(),
  Cc: z.string().max(10_000).optional(),
  CcFull: z.array(addr).max(100).optional(),
  BccFull: z.array(addr).max(100).optional(),
  OriginalRecipient: z.string().max(320).optional(),
  Attachments: z.array(z.object({
    Name: z.string().max(500).optional(),
    Content: z.string(),
    ContentType: z.string().max(200).optional(),
    ContentLength: z.number().optional(),
  }).loose()).max(1000).optional(),
}).loose()
export type PostmarkPayload = z.infer<typeof postmarkPayload>

const EMAIL = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g

/** Lower-cased sender address, or null. */
export function senderOf(p: PostmarkPayload): string | null {
  const e = (p.FromFull?.Email ?? p.From?.match(EMAIL)?.[0] ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

/** Alias tokens (upper-case base32, 16 chars = 80 bits) of every recipient at `domain`; `+tag` suffixes ignored. */
export function aliasTokensOf(p: PostmarkPayload, domain: string): string[] {
  const all = [
    ...[p.ToFull, p.CcFull, p.BccFull].flatMap((l) => (l ?? []).map((a) => a.Email)),
    ...[p.To, p.Cc, p.OriginalRecipient].flatMap((s) => s?.match(EMAIL) ?? []),
  ]
  const d = domain.trim().toLowerCase()
  const tokens = all.map((a) => a.trim().toLowerCase()).filter((a) => a.endsWith(`@${d}`))
    .map((a) => a.slice(0, -(d.length + 1)).split('+')[0].toUpperCase())
    .filter((t) => /^[A-Z2-7]{16}$/.test(t))
  return [...new Set(tokens)]
}

export type ParsedAttachment = { index: number; name: string; bytes: Uint8Array } | { index: number; reason: 'too_many_attachments' | 'file_too_large' | 'empty_file' }

/** Decodes up to MAX_FILES attachments; larger ones are refused before decoding where the declared length allows. */
export function attachmentsOf(p: PostmarkPayload): ParsedAttachment[] {
  return (p.Attachments ?? []).map((a, index): ParsedAttachment => {
    if (index >= MAX_FILES) return { index, reason: 'too_many_attachments' }
    if ((a.ContentLength ?? 0) > MAX_FILE_BYTES || a.Content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) return { index, reason: 'file_too_large' }
    const bytes = Buffer.from(a.Content, 'base64')
    if (!bytes.length) return { index, reason: 'empty_file' }
    if (bytes.length > MAX_FILE_BYTES) return { index, reason: 'file_too_large' }
    return { index, name: (a.Name ?? '').slice(0, 200) || `email-attachment-${index + 1}`, bytes: new Uint8Array(bytes) }
  })
}

/** HTTP Basic credentials, compared in constant time (Postmark sends them from the webhook URL). */
export function basicAuthOk(header: string | null, user: string, password: string): boolean {
  const m = /^Basic\s+(.+)$/i.exec(header ?? '')
  const got = m ? Buffer.from(m[1], 'base64').toString('utf8') : ''
  return timingSafeEqualStr(got, `${user}:${password}`)
}
