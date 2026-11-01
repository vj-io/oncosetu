// Create a share link (FR-PAS-02): ciphertext + iv only. The AES key stays in the creator's browser and the URL fragment.
import { z } from 'zod'
import { route } from '@/server/http'
import { createShare } from '@/server/shares/shares'

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/)
const Body = z.strictObject({ // strict: a stray `key` field is rejected, never stored
  patientId: z.uuid().optional(),
  snapshotId: z.uuid(),
  ciphertext: b64url.min(24).max(2_000_000),
  iv: b64url.length(16), // 12 bytes
  scope: z.enum(['index', 'index_with_quotes']).default('index'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  passcode: z.string().min(6).max(64).nullable(),
})

export const POST = route({ auth: 'any', roles: ['patient', 'caregiver', 'desk', 'records', 'clinician'], body: Body, maxBytes: 2_200_000 }, async (ctx) =>
  createShare(ctx, ctx.body))
