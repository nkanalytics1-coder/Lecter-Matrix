import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

// Vitest v4 does not auto-inject .env.local into process.env; bootstrap it here.
if (!process.env['DATABASE_URL_TEST'] && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf-8').match(/^DATABASE_URL_TEST=(.+)$/m)
  const val = m?.[1]?.trim()
  if (val) process.env['DATABASE_URL_TEST'] = val
}

const TEST_DB = process.env['DATABASE_URL_TEST']
const ROOT = process.cwd()
const MIGRATIONS = [
  '0001_extensions.sql',
  '0002_projects.sql',
  '0003_fact.sql',
  '0004_results.sql',
]

describe.skipIf(!TEST_DB)('db: migrations + seed', () => {
  let sql!: ReturnType<typeof postgres>

  beforeAll(async () => {
    if (!TEST_DB) throw new Error('DATABASE_URL_TEST is required for DB tests')
    sql = postgres(TEST_DB, { connect_timeout: 10 })

    // Full reset: clean-slate schema
    await sql.unsafe(
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;',
    )

    // Apply migrations in order
    for (const file of MIGRATIONS) {
      await sql.unsafe(readFileSync(join(ROOT, 'supabase', 'migrations', file), 'utf-8'))
    }

    // Seed
    await sql.unsafe(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf-8'))
  }, 30_000)

  afterAll(async () => {
    await sql.end()
  })

  it('has all 7 expected tables', async () => {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `
    const names = rows.map(r => r.tablename)
    for (const table of [
      'cannibalization_group',
      'cannibalization_member',
      'detection_run',
      'gsc_connection',
      'gsc_metric',
      'group_state',
      'project',
    ]) {
      expect(names, `table '${table}' should exist`).toContain(table)
    }
  })

  it('gsc_metric upsert is idempotent and updates values', async () => {
    const [{ count: before }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM gsc_metric
    `

    // Re-upsert all seed rows with a sentinel clicks value
    await sql`
      INSERT INTO gsc_metric (project_id, date, query, query_norm, page, page_type, clicks, impressions, position)
      SELECT project_id, date, query, query_norm, page, page_type, 777, impressions, position
      FROM gsc_metric
      ON CONFLICT (project_id, date, query_norm, page)
      DO UPDATE SET clicks = EXCLUDED.clicks
    `

    const [{ count: after }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM gsc_metric
    `
    expect(after).toBe(before)

    // All rows should now carry the sentinel value
    const [{ clicks }] = await sql<{ clicks: number }[]>`
      SELECT clicks FROM gsc_metric ORDER BY date, query_norm, page LIMIT 1
    `
    expect(clicks).toBe(777)
  })

  it('rejects an invalid recommended_action on cannibalization_group', async () => {
    const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM project LIMIT 1`

    await expect(
      sql`
        INSERT INTO cannibalization_group (
          project_id, group_key, query_norm, cann_type,
          total_clicks, total_impressions, member_count, severity, recommended_action
        ) VALUES (
          ${id}, ${'ck-test-invalid'}, ${'test-query'}, ${'blog_vs_blog'},
          ${0}, ${0}, ${2}, ${0.5}, ${'invalid_action_xyz'}
        )
      `,
    ).rejects.toThrow()
  })

  it('seed is idempotent — applying it twice does not error', async () => {
    const seed = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf-8')
    await expect(sql.unsafe(seed)).resolves.toBeDefined()
  })
})
