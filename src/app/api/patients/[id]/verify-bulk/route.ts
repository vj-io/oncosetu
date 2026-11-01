import { route } from '@/server/http'
import { bulkBody, idParam, verifyBulk } from '@/server/ledger/verify'

// FR-LED-05: only eligible items are verified; the rest come back in `skipped` with reasons.
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: bulkBody }, (ctx) => verifyBulk(ctx, idParam(ctx)))
