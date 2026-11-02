/**
 * Take an encrypted backup now, from a laptop: the same code as GET /api/cron/backup (src/server/backup/backup.ts).
 * Uploads to the private Blob store, then applies retention. Prints ids and sizes only.
 *
 *   npx tsx --env-file=.env.local scripts/backup.ts           take one
 *   npx tsx --env-file=.env.local scripts/backup.ts --list    list the stored backups, newest first
 *
 * Needs DATABASE_URL_UNPOOLED (owner), BACKUP_KEY, BLOB_READ_WRITE_TOKEN.
 */
import { listBackups, runBackup } from '../src/server/backup/backup'

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`

if (process.argv.includes('--list')) {
  void listBackups().then((all) => { for (const b of all) console.log(`${b.pathname}  ${mb(b.size)}  uploaded ${b.uploadedAt.toISOString()}`) })
} else runBackup().then((r) => {
  console.log(`backup ${r.id}`)
  console.log(`  snapshot ${r.createdAt}; ${r.tables} tables, ${r.rows} rows; ${mb(r.plainBytes)} plaintext → ${mb(r.bytes)} encrypted`)
  console.log(`  export ${(r.ms.export / 1000).toFixed(1)} s, total with upload ${(r.ms.total / 1000).toFixed(1)} s`)
  console.log(`  retention: ${r.deleted.length} deleted${r.deleted.length ? ` (${r.deleted.join(', ')})` : ''}, ${r.kept} kept`)
}, (e) => {
  console.error((e instanceof Error ? e.message : String(e)).replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1***@'))
  process.exit(1)
})
