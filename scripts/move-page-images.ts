/**
 * One-off (0030): moves page images stored before 0030 from Postgres (document_files.bytes_enc) to the object store, the way
 * originals are kept, so the free 1 GB database stops filling with pictures. Safe to run again: it only picks rows that
 * still hold their bytes, and an interrupted move is redone from the start (same object key).
 *
 *   npx tsx --env-file=.env.local scripts/move-page-images.ts                                   # shows the target and counts, moves nothing
 *   npx tsx --env-file=.env.local scripts/move-page-images.ts --db <neon endpoint id> --bucket <S3_BUCKET>
 *
 * Moves nothing unless --db names the database DATABASE_URL_UNPOOLED points at (the Neon endpoint id, e.g.
 * ep-green-wildflower-aocj27a9, or localhost) and --bucket the S3_BUCKET in use: the operator states the target, the script
 * checks it. Needs migration 0030 applied, the owner role (DATABASE_URL_UNPOOLED), S3_* and APP_MASTER_KEY.
 *
 * Per page image: upload the row's ciphertext unchanged to o/<org>/<row id>, download it again, decrypt it with the row's
 * own key and compare the SHA-256 with the row; only then empty bytes_enc and set object_key in one update (the 0030 guard
 * allows exactly that, with oncosetu.moving_files on). Any mismatch stops the run before the database is touched for that row.
 * Prints counts and sizes only.
 */
import postgres, { type Sql } from 'postgres'
import { decryptBytes, sha256Hex } from '../src/server/crypto'
import { objectStore, type ObjectStore } from '../src/server/objects'

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** Page images still in Postgres, and those already in the object store. */
export async function pageImageCounts(sql: Sql) {
  const [c] = await sql`select count(*) filter (where object_key is null and octet_length(bytes_enc) > 0)::int as "inDb",
      coalesce(sum(octet_length(bytes_enc)) filter (where object_key is null), 0)::bigint as "dbBytes",
      count(*) filter (where object_key is not null)::int as "inStore", count(*)::int as total
    from document_files where kind = 'page_image'`
  return { inDb: c.inDb as number, dbBytes: Number(c.dbBytes), inStore: c.inStore as number, total: c.total as number }
}

/** Moves every page image still in Postgres (of one document with `only`: tests) to `store`, checking each one; returns how many and how many bytes. */
export async function movePageImages(sql: Sql, store: ObjectStore, say: (line: string) => void = () => {}, only?: { documentId: string }) {
  let moved = 0, bytes = 0
  for (;;) {
    const rows = await sql`select id, org_id, bytes_enc, dek_wrapped, sha256 from document_files
      where kind = 'page_image' and object_key is null and octet_length(bytes_enc) > 0
      ${only ? sql`and document_id = ${only.documentId}` : sql``} order by id limit 20`
    if (!rows.length) return { moved, bytes }
    for (const r of rows) {
      const key = `o/${r.org_id}/${r.id}`
      await store.put(key, r.bytes_enc as Buffer)
      const back = await store.get(key)
      let same = false
      try { same = sha256Hex(decryptBytes(Buffer.from(back), r.dek_wrapped as string)) === r.sha256 } catch { /* AES-GCM refused a changed copy */ }
      if (!same) throw new Error(`page image ${r.id}: the uploaded copy does not match its SHA-256; its row was left as it was`)
      await sql.begin(async (tx) => {
        await tx`select set_config('oncosetu.moving_files', 'on', true)`
        const done = await tx`update document_files set bytes_enc = ${Buffer.alloc(0)}, object_key = ${key}
          where id = ${r.id as string} and object_key is null returning id`
        if (done.length !== 1) throw new Error(`page image ${r.id}: the row changed while it was being moved`)
      })
      moved++
      bytes += (r.bytes_enc as Buffer).length
    }
    say(`moved ${moved} (${mb(bytes)})`)
  }
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is required (run with --env-file=.env.local)')
  const store = objectStore()
  if (!store) throw new Error('no object store is configured (S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)')
  const db = new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
  const bucket = process.env.S3_BUCKET!
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const before = await pageImageCounts(sql)
    console.log(`database ${db}, bucket ${bucket} at ${new URL(process.env.S3_ENDPOINT!).hostname}`)
    console.log(`page images: ${before.total} in all, ${before.inDb} in the database (${mb(before.dbBytes)}), ${before.inStore} in the object store`)
    if (arg('--db') !== db || arg('--bucket') !== bucket) {
      console.log('REFUSED: nothing moved. Name the target to move: --db <database> --bucket <bucket>, both as printed above.')
      process.exitCode = 1
      return
    }
    const r = await movePageImages(sql, store, console.log)
    const after = await pageImageCounts(sql)
    console.log(`done: moved ${r.moved} (${mb(r.bytes)}); now ${after.inDb} in the database, ${after.inStore} in the object store, ${after.total} in all`)
    if (after.inDb !== 0) { console.log('page images are still in the database (written during the run by a deployment without 0030?): run again'); process.exitCode = 1 }
  } finally {
    await sql.end()
  }
}

if (process.argv[1]?.endsWith('move-page-images.ts')) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
