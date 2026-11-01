import { route } from '@/server/http'
import { idParam, resolveBody, resolveConflict } from '@/server/ledger/verify'

// E-LED-03/04: a clinician resolves a conflict with a note (and optionally which side to keep).
export const POST = route({ auth: 'staff', roles: ['clinician'], body: resolveBody }, (ctx) => resolveConflict(ctx, idParam(ctx)))
