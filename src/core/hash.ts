// Server-side hashing helper (node:crypto). Modules that import this (gate, radar, ledger) are server-only.
import { createHash } from 'node:crypto'

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
