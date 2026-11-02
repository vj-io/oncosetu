// Table rows <-> JSON lines, with Postgres doing both conversions so every type survives exactly:
//   out: row_to_json() of the row (timestamptz as ISO 8601 with microseconds in UTC, enums and dates as strings, arrays as
//        JSON arrays, numbers as written by Postgres); bytea columns as base64 text; json/jsonb values wrapped in a
//        one-element array ([value]), because a JSON `null` value and SQL NULL both print as `null` otherwise;
//   in:  json_to_recordset() typed with each column's own type (bytea read as text, then decode(…, 'base64'); json/jsonb
//        unwrapped with -> 0).
// JavaScript never parses a row, so nothing is rounded (no Date, no float, no bigint). One line per row; JSON escapes
// newlines inside values. Rows come out in primary-key order, so exporting the same data twice gives the same bytes.
import type { ISql } from 'postgres'

type Q = Pick<ISql, 'unsafe'>
export type Column = { name: string; type: string }
export type Table = { name: string; columns: Column[]; pk: string[] }

const id = (n: string) => `"${n.replace(/"/g, '""')}"`
const isJson = (c: Column) => c.type === 'json' || c.type === 'jsonb'

/** Base tables of `schema`, parents before children (foreign keys), ties in creation order (= the drizzle/ migration order). */
export async function listTables(sql: Q, schema = 'public'): Promise<Table[]> {
  const rows = await sql.unsafe(`
    select c.relname as name,
      (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
      (select coalesce(json_agg(a.attname order by array_position(k.conkey, a.attnum)), '[]')
         from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
        where k.conrelid = c.oid and k.contype = 'p') as pk,
      (select coalesce(json_agg(distinct p.relname), '[]') from pg_constraint k join pg_class p on p.oid = k.confrelid
        where k.conrelid = c.oid and k.contype = 'f' and k.confrelid <> c.oid) as parents
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind = 'r' order by c.oid`, [schema])
  const all = rows as unknown as (Table & { parents: string[] })[]
  const names = new Set(all.map((t) => t.name))
  const out: Table[] = [], done = new Set<string>()
  while (out.length < all.length) {
    const next = all.find((t) => !done.has(t.name) && t.parents.every((p) => done.has(p) || !names.has(p)))
    if (!next) throw new Error(`foreign-key cycle among: ${all.filter((t) => !done.has(t.name)).map((t) => t.name).join(', ')}`)
    out.push({ name: next.name, columns: next.columns, pk: next.pk })
    done.add(next.name)
  }
  return out
}

export function selectSql(schema: string, t: Table): string {
  const cols = t.columns.map((c) => c.type === 'bytea' ? `translate(encode(${id(c.name)}, 'base64'), E'\\n', '') as ${id(c.name)}`
    : isJson(c) ? `case when ${id(c.name)} is null then null else json_build_array(${id(c.name)}) end as ${id(c.name)}` : id(c.name))
  const order = t.pk.length ? t.pk.map((c) => `x.${id(c)}`).join(', ') : 'row_to_json(x)::text'
  return `select row_to_json(x)::text as line from (select ${cols.join(', ')} from ${id(schema)}.${id(t.name)}) x order by ${order}`
}

export function insertSql(schema: string, t: Table): string {
  const defs = t.columns.map((c) => `${id(c.name)} ${c.type === 'bytea' ? 'text' : c.type}`)
  const vals = t.columns.map((c) => c.type === 'bytea' ? `decode(r.${id(c.name)}, 'base64')` : isJson(c) ? `r.${id(c.name)} -> 0` : `r.${id(c.name)}`)
  return `insert into ${id(schema)}.${id(t.name)} (${t.columns.map((c) => id(c.name)).join(', ')}) select ${vals.join(', ')} from json_to_recordset($1::text::json) as r(${defs.join(', ')})`
}

/** Run inside a transaction with `timezone = 'UTC'` (the caller's job) so timestamps always print the same way. */
export async function* exportRows(sql: Q, schema: string, t: Table): AsyncGenerator<string> {
  // ponytail: fixed cursor sizes; a table with files moves 8 rows (≤ ~45 MB at the 4 MB upload cap) per round trip.
  const batch = t.columns.some((c) => c.type === 'bytea') ? 8 : 500
  for await (const rows of sql.unsafe(selectSql(schema, t)).cursor(batch)) for (const r of rows) yield r.line as string
}

/** Batched inserts of exported lines into `t` (≤ ~4 MB of JSON or 1000 rows per statement). */
export function rowLoader(sql: Q, schema: string, t: Table) {
  const q = insertSql(schema, t)
  let batch: string[] = [], bytes = 0, rows = 0
  const flush = async () => {
    if (!batch.length) return
    await sql.unsafe(q, [`[${batch.join(',')}]`])
    rows += batch.length
    batch = []
    bytes = 0
  }
  return {
    async add(line: string) {
      batch.push(line)
      bytes += line.length
      if (bytes > 4_000_000 || batch.length >= 1000) await flush()
    },
    async end() { await flush(); return rows },
  }
}
