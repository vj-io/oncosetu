// Vercel Cron (vercel.json, daily): encrypted logical backup of the whole database to the private Blob store, then
// deletes backups older than BACKUP_RETENTION_DAYS (default 35, the 7 newest always kept). See src/server/backup/backup.ts
// (and why it reads with the owner role). Responds and logs ids and sizes only.
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { runBackup } from '@/server/backup/backup'

export const maxDuration = 300

export const GET = route({ auth: 'public' }, async ({ req, log }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  if (!process.env.BACKUP_KEY || !process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'not_configured', 'Backups are not configured')
  const r = await runBackup()
  log.info('backup', { id: r.id, bytes: r.bytes, rows: r.rows, ms: r.ms.total, deleted: r.deleted.length })
  return { ok: true, backup: r }
})
