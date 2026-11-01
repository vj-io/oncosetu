import { route } from '@/server/http'
import { sealSnapshot } from '@/server/ledger/seal'
import { idParam } from '@/server/ledger/verify'

// FR-LED-01: clinician seals the current record → canonical JSON, SHA-256, Ed25519 signature.
export const POST = route({ auth: 'staff', roles: ['clinician'] }, (ctx) => sealSnapshot(ctx, idParam(ctx)))
