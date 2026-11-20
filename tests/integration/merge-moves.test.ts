// A patient merge (src/server/admin/duplicates.ts approveMerge) moves every table in MOVE from the duplicate to the
// survivor as the app role. A table in that list whose patient_id the app role may not UPDATE makes every merge fail
// with "permission denied" at that table, after the earlier tables have already moved. Needs the DB env.
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { MOVE } from '../../src/server/admin/duplicates'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
afterAll(() => owner.end())

describe('patient merge: every moved table', () => {
  it('voice clips follow the person (pre-visit answers stay with their statements)', () => {
    expect(MOVE).toContain('voice_clips')
  })
  it('lets the app role update patient_id', async () => {
    const rows = await owner<{ t: string; ok: boolean }[]>`
      select t, has_column_privilege('oncosetu_app', format('public.%I', t), 'patient_id', 'UPDATE') as ok
      from unnest(${[...MOVE]}::text[]) as t`
    expect(rows).toHaveLength(MOVE.length)
    expect(rows.filter((r) => !r.ok).map((r) => r.t)).toEqual([])
  })
})
