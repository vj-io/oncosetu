/**
 * One-off (0030): moves file bodies still stored in Postgres to the object store, where every new file goes, so the free
 * 1 GB database stops filling: document_files of every kind (page images, and any original stored before 0028 or without
 * a store) and voice_clips. Safe to run again: it picks only rows that still hold their bytes, and an interrupted move is
 * redone from the start (same object key).
 * Not moved: inbound_hold_files (a hold lives 10 minutes, its files are deleted on release, discard or expiry) and
 * upload_chunks (deleted when the upload closes, at most 6 hours); both go to the object store from now on anyway.
 *
 *   npx tsx --env-file=.env.local scripts/move-files-to-objects.ts                                   # shows the target and counts, moves nothing
 *   npx tsx --env-file=.env.local scripts/move-files-to-objects.ts --db <neon endpoint id> --bucket <S3_BUCKET>
 *
 * Moves nothing unless --db names the database DATABASE_URL_UNPOOLED points at (the Neon endpoint id, e.g.
 * ep-green-wildflower-aocj27a9, or localhost) and --bucket the S3_BUCKET in use: the operator states the target, the script
 * checks it. Needs migration 0030 applied, the owner role (DATABASE_URL_UNPOOLED), S3_* and APP_MASTER_KEY.
 *
 * Per file: upload the row's ciphertext unchanged to o/<org>/<row id>, download it again and check that it decrypts with the
 * row's own key (AES-GCM refuses any changed byte) and (document_files) that the plaintext matches the row's SHA-256; only then empty
 * bytes_enc and set object_key in one update (for document_files the 0030 guard allows exactly that, with
 * oncosetu.moving_files on). Any mismatch stops the run before the database is touched for that row. Prints counts only.
 */
import postgres, { type Sql } from 'postgres'
import { decryptBytes, sha256Hex } from '../src/server/crypto'
import { objectStore, type ObjectStore } from '../src/server/objects'

const TABLES = ['document_files', 'voice_clips'] as const
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** Per table: files still in Postgres (and their bytes), and files already in the object store. */
export async function fileCounts(sql: Sql) {
  const out: Record<string, { inDb: number; dbBytes: number; inStore: number }> = {}
  for (const t of TABLES) {
    const [c] = await sql`select count(*) filter (where object_key is null and octet_length(bytes_enc) > 0)::int as "inDb",
        coalesce(sum(octet_length(bytes_enc)) filter (where object_key is null), 0)::bigint as "dbBytes",
        count(*) filter (where object_key is not null)::int as "inStore"
      from ${sql(t)}`
    out[t] = { inDb: c.inDb as number, dbBytes: Number(c.dbBytes), inStore: c.inStore as number }
  }
  return out
}

/** Moves every file body still in Postgres (one patient's with `only`: tests) to `store`, checking each one. */
export async function moveFilesToObjects(sql: Sql, store: ObjectStore, say: (line: string) => void = () => {}, only?: { patientId: string }) {
  let moved = 0, bytes = 0
  for (const t of TABLES) {
    for (;;) {
      const rows = await sql`select id, org_id, bytes_enc, dek_wrapped, ${t === 'document_files' ? sql`sha256` : sql`null as sha256`}
        from ${sql(t)} where object_key is null and octet_length(bytes_enc) > 0
        ${only ? sql`and patient_id = ${only.patientId}` : sql``} order by id limit 20`
      if (!rows.length) break
      for (const r of rows) {
        const key = `o/${r.org_id}/${r.id}`
        const sealed = r.bytes_enc as Buffer
        await store.put(key, sealed)
        const back = Buffer.from(await store.get(key))
        let same = false
        try {
          const plain = decryptBytes(back, r.dek_wrapped as string) // AES-GCM: throws on a changed copy
          same = r.sha256 === null || sha256Hex(plain) === r.sha256
        } catch { /* same stays false */ }
        if (!same) throw new Error(`${t} ${r.id}: the uploaded copy does not match; its row was left as it was`)
        await sql.begin(async (tx) => {
          await tx`select set_config('oncosetu.moving_files', 'on', true)`
          const done = await tx`update ${tx(t)} set bytes_enc = ${Buffer.alloc(0)}, object_key = ${key}
            where id = ${r.id as string} and object_key is null returning id`
          if (done.length !== 1) throw new Error(`${t} ${r.id}: the row changed while it was being moved`)
        })
        moved++
        bytes += sealed.length
      }
      say(`${t}: moved ${moved} so far (${mb(bytes)})`)
    }
  }
  return { moved, bytes }
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is required (run with --env-file=.env.local)')
  const store = objectStore()
  if (!store) throw new Error('no object store is configured (S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)')
  const db = new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
  const bucket = process.env.S3_BUCKET!
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
  const show = (c: Awaited<ReturnType<typeof fileCounts>>) =>
    TABLES.map((t) => `${t}: ${c[t].inDb} in the database (${mb(c[t].dbBytes)}), ${c[t].inStore} in the object store`).join('; ')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    console.log(`database ${db}, bucket ${bucket} at ${new URL(process.env.S3_ENDPOINT!).hostname}`)
    console.log(show(await fileCounts(sql)))
    if (arg('--db') !== db || arg('--bucket') !== bucket) {
      console.log('REFUSED: nothing moved. Name the target to move: --db <database> --bucket <bucket>, both as printed above.')
      process.exitCode = 1
      return
    }
    const r = await moveFilesToObjects(sql, store, console.log)
    const after = await fileCounts(sql)
    console.log(`done: moved ${r.moved} (${mb(r.bytes)}); now ${show(after)}`)
    if (TABLES.some((t) => after[t].inDb !== 0)) { console.log('files are still in the database (written during the run by a deployment without 0030?): run again'); process.exitCode = 1 }
  } finally {
    await sql.end()
  }
}

if (process.argv[1]?.endsWith('move-files-to-objects.ts')) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
