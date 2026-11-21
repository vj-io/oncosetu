// REC-02 everywhere: a stored field that cannot be decrypted (a damaged row, or one written with another key) must not
// take down a list, a header or a sweep that also holds readable rows. Only the row id and an error code are logged.
import { decryptField } from './crypto'
import { log } from './log'

/** Shown in place of a name that cannot be read. */
export const UNREADABLE_NAME = 'Record unreadable — contact admin'

const codeOf = (e: unknown) => (e as { code?: unknown }).code ?? (e as Error).name

/** The decrypted value, or null when it is missing or cannot be read (logged with `where` and the row id, never the contents). */
export function readOrNull(enc: string | null | undefined, where: string, rowId: string): string | null {
  if (!enc) return null
  try {
    return decryptField(enc)
  } catch (e) {
    log.error(`${where} could not be decrypted`, { patientId: rowId, errorCode: codeOf(e) })
    return null
  }
}

/** A person's name for display: the decrypted name, or the plain unreadable flag. */
export const nameOrFlag = (enc: string | null | undefined, where: string, rowId: string): string =>
  readOrNull(enc, where, rowId) ?? UNREADABLE_NAME
