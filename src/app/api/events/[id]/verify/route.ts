import { route } from '@/server/http'
import { idParam, verifyBody, verifyEvent } from '@/server/ledger/verify'

// FR-VER-01..03: desk (and admin/auditor) get 403 here; records get 403 on clinician-tier items inside verifyEvent.
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: verifyBody }, (ctx) => verifyEvent(ctx, idParam(ctx)))
