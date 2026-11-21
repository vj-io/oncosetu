// Forgotten password: e-mail + authenticator code + new password, from the sign-in page (src/server/forgot-password.ts).
// Public, like sign-in: no transaction, so the audit row and the wrong-code count of a refusal are kept.
import { z } from 'zod'
import { route } from '@/server/http'
import { resetForgottenPassword } from '@/server/forgot-password'

export const POST = route({
  auth: 'public',
  body: z.object({ email: z.string().max(254), totp: z.string().max(12), next: z.string().max(200) }),
}, async ({ body, requestId }) => ({ ok: true, ...(await resetForgottenPassword(body, requestId)) }))
