// Public: does this signature cover this share-payload digest? Used by the share viewer only when the browser has no
// WebCrypto Ed25519. It receives the SHA-256 digest, never the decrypted record.
import { z } from 'zod'
import { route } from '@/server/http'
import { shareDigestValid } from '@/server/shares/shares'

const Body = z.strictObject({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/), // 64-byte Ed25519 signature, base64url
  keyId: z.string().min(1).max(64),
})

export const POST = route({ auth: 'public', body: Body }, ({ body }) => ({ valid: shareDigestValid(body.digest, body) }))
