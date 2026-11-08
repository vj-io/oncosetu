// FR-ING-02 upload batch limits (client side: each file is its own request, so the batch exists only in the browser).
import { MB } from '@/core/limits'

export const MAX_BATCH = 50
export const MAX_BATCH_BYTES = 200 * MB

/** Why a chosen set of files is refused whole (never cut short silently), or null. `bytes` is null when sizes are not known yet. */
export function batchProblem(count: number, bytes: number | null): string | null {
  if (count <= MAX_BATCH && (bytes === null || bytes <= MAX_BATCH_BYTES)) return null
  return `You chose ${count} file${count === 1 ? '' : 's'}${bytes !== null ? ` (${Math.ceil(bytes / MB)} MB)` : ''}. One upload takes up to ${MAX_BATCH} files and ${MAX_BATCH_BYTES / MB} MB in all, so nothing was uploaded. Choose fewer files and add the rest in a second upload.`
}
