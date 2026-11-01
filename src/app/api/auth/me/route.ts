import { route } from '@/server/http'

export const GET = route({ auth: 'any' }, async ({ session }) => ({ session: { ...session, sessionId: undefined } }))
