import { HttpError, route } from '@/server/http'
import { verifySnapshotPublic } from '@/server/ledger/seal'
import { idParam } from '@/server/ledger/verify'

// Public: hash + signature verdict for a sealed snapshot. Ids, hashes, counts and times only — no PHI.
export const GET = route({ auth: 'public' }, async (ctx) => {
  const verdict = await verifySnapshotPublic(idParam(ctx))
  if (!verdict) throw new HttpError(404, 'not_found', 'Not found')
  return verdict
})
