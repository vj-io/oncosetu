import { route } from '@/server/http'
import { publicKeys } from '@/server/crypto'

// Public: Ed25519 verification keys by key id, for offline checks of sealed snapshots.
export const GET = route({ auth: 'public' }, () => ({ keys: publicKeys() }))
