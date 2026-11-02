// JSONL round trip of every column type the backup has to carry (src/server/backup/jsonl.ts), against real Postgres.
// Uses session-local TEMP objects only, so it never touches the app's tables.   npm run test:integration (needs .env.local)
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { exportRows, listTables, rowLoader } from '../../src/server/backup/jsonl'

if (!process.env.DATABASE_URL_UNPOOLED && existsSync('.env.local')) process.loadEnvFile('.env.local')
const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, prepare: false, onnotice: () => {} })
let schema = ''

beforeAll(async () => {
  await sql`set timezone = 'UTC'`
  await sql`create type pg_temp.mood as enum ('calm', 'tense')`
  for (const t of ['src', 'dst']) {
    await sql.unsafe(`create temp table ${t} (id int primary key, b bytea, j jsonb, js json, ts timestamptz, d date, e pg_temp.mood,
      ids uuid[], r real, n numeric, big bigint, txt text, flag boolean)`)
  }
  ;[{ schema }] = await sql`select nspname as schema from pg_namespace where oid = pg_my_temp_schema()`
  await sql`insert into src values
    (1, decode(repeat('00ff0a0d5c22', 40), 'hex'), '{"a": [1, 2.5, null, "x\\ny"], "b": {"ü": "\u2028"}}', '{"keep":  "spacing"}',
     '2026-11-02 01:01:23.741234+05:30', '2028-02-29', 'tense', '{0193a000-0000-7000-8000-000000000001,0193a000-0000-7000-8000-000000000002}',
     0.1, 12345678901234567890.123456789, 9007199254740993, E'line1\nline2 "quoted" \\ back\tslash', true),
    (2, '\\x', '"a string"', '[]', '-infinity', '1900-01-01', 'calm', '{}', 'NaN', 0, -1, '', false),
    (3, null, null, null, null, null, null, null, null, null, null, null, null),
    (4, null, 'null', 'null', null, null, null, '{NULL}', null, null, null, null, null)`
})
afterAll(async () => { await sql.end() })

it('exports and reloads bytea, jsonb, json, timestamptz, date, enum, uuid[], real, numeric, bigint, text and nulls exactly', async () => {
  const tables = await listTables(sql, schema)
  const src = tables.find((t) => t.name === 'src')!, dst = tables.find((t) => t.name === 'dst')!
  expect(src.pk).toEqual(['id'])
  expect(src.columns.find((c) => c.name === 'e')!.type).toMatch(/mood$/)

  const lines: string[] = []
  for await (const l of exportRows(sql, schema, src)) lines.push(l)
  expect(lines).toHaveLength(4)
  expect(lines.every((l) => !l.includes('\n'))).toBe(true)
  const first = JSON.parse(lines[0])
  expect(first.b).toBe(Buffer.from('00ff0a0d5c22'.repeat(40), 'hex').toString('base64')) // base64, no line wrapping
  expect(first.j).toEqual([{ a: [1, 2.5, null, 'x\ny'], b: { 'ü': '\u2028' } }]) // json/jsonb wrapped: [value]
  expect(JSON.parse(lines[3])).toMatchObject({ j: [null], js: [null], ids: [null] }) // JSON null is not SQL NULL (row 3)
  expect(first.ts).toBe('2026-11-01T19:31:23.741234+00:00') // microseconds kept, UTC
  expect(first.big).toBe(9007199254740993) // JSON number text from Postgres (JS rounds it only here, in the test)
  expect(lines[0]).toContain('"big":9007199254740993')
  expect(JSON.parse(lines[2])).toEqual(Object.fromEntries(src.columns.map((c) => [c.name, c.name === 'id' ? 3 : null])))

  const load = rowLoader(sql, schema, { ...dst, name: 'dst' })
  for (const l of lines) await load.add(l)
  expect(await load.end()).toBe(4)

  const again: string[] = []
  for await (const l of exportRows(sql, schema, dst)) again.push(l)
  expect(again).toEqual(lines) // byte-identical second export
  // and equal as SQL values (json has no equality operator: compared as text), including a jsonb/json `null` vs SQL NULL
  const v = (t: string) => `select id, b, j, js::text, ts, d, e, ids, r, n, big, txt, flag, j is null as jn, js is null as jsn from ${t}`
  const [{ n }] = await sql.unsafe(`select count(*)::int as n from ((${v('src')} except ${v('dst')}) union all (${v('dst')} except ${v('src')})) x`)
  expect(n).toBe(0)
})
