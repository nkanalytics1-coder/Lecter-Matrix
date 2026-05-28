import { vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

// Vitest v4 does not auto-inject .env.local; bootstrap it here.
if (!process.env['DATABASE_URL_TEST'] && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf-8').match(/^DATABASE_URL_TEST=(.+)$/m)
  const val = m?.[1]?.trim()
  if (val) process.env['DATABASE_URL_TEST'] = val
}

const TEST_DB = process.env['DATABASE_URL_TEST']

import { persistDate } from '../../server/ingest/persist'

const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const ROOT = process.cwd()
const MIGRATIONS = [
  '0001_extensions.sql',
  '0002_projects.sql',
  '0003_fact.sql',
  '0004_results.sql',
]

type GlobalWithPg = typeof globalThis & { _pgClient?: { end: () => Promise<void> } }

describe.skipIf(!TEST_DB)('persist: persistDate', () => {
  let sql!: ReturnType<typeof postgres>

  beforeAll(async () => {
    if (!TEST_DB) throw new Error('DATABASE_URL_TEST is required')

    // Point serviceClient singleton at the test DB
    process.env['SUPABASE_DB_URL'] = TEST_DB
    delete (globalThis as GlobalWithPg)['_pgClient']

    sql = postgres(TEST_DB, { connect_timeout: 10 })

    await sql.unsafe(
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;',
    )

    for (const file of MIGRATIONS) {
      await sql.unsafe(readFileSync(join(ROOT, 'supabase', 'migrations', file), 'utf-8'))
    }

    await sql.unsafe(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf-8'))
  }, 30_000)

  afterAll(async () => {
    const g = globalThis as GlobalWithPg
    await g._pgClient?.end()
    delete g['_pgClient']
    await sql.end()
  })

  it('inserts rows and stores normalized values', async () => {
    await persistDate(PROJECT_ID, '2025-03-01', [
      {
        query: 'Scarpe da Corsa',
        page: 'https://example.com/collections/scarpe',
        clicks: 42,
        impressions: 400,
        position: 3.5,
      },
      {
        query: 'review scarpe',
        page: 'https://example.com/blogs/review-scarpe',
        clicks: 10,
        impressions: 80,
        position: 7.0,
      },
    ])

    const rows = await sql<{ query_norm: string; clicks: number; page_type: string }[]>`
      SELECT query_norm, clicks, page_type
      FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-01'
      ORDER BY query_norm
    `
    expect(rows).toHaveLength(2)

    const first = rows[0]
    if (first === undefined) throw new Error('Expected row 0')
    expect(first.query_norm).toBe('review scarpe')
    expect(first.page_type).toBe('blog')

    const second = rows[1]
    if (second === undefined) throw new Error('Expected row 1')
    expect(second.query_norm).toBe('scarpe da corsa')
    expect(second.clicks).toBe(42)
    expect(second.page_type).toBe('collection')
  })

  it('re-applying identical rows leaves counts stable', async () => {
    const inputRows = [
      {
        query: 'sneakers bianche',
        page: 'https://example.com/collections/sneakers',
        clicks: 20,
        impressions: 200,
        position: 4.0,
      },
    ]

    await persistDate(PROJECT_ID, '2025-03-02', inputRows)

    const [before] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-02'
    `
    if (before === undefined) throw new Error('Expected count row')

    // Re-apply identical data
    await persistDate(PROJECT_ID, '2025-03-02', inputRows)

    const [after] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-02'
    `
    if (after === undefined) throw new Error('Expected count row')
    expect(after.count).toBe(before.count)

    const [row] = await sql<{ clicks: number }[]>`
      SELECT clicks FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-02' AND query_norm = 'sneakers bianche'
    `
    if (row === undefined) throw new Error('Expected metric row')
    expect(row.clicks).toBe(20)
  })

  it('re-applying same date with new values updates existing rows', async () => {
    await persistDate(PROJECT_ID, '2025-03-03', [
      {
        query: 'mocassini uomo',
        page: 'https://example.com/products/mocassini',
        clicks: 5,
        impressions: 50,
        position: 6.0,
      },
    ])

    // Re-apply with updated clicks
    await persistDate(PROJECT_ID, '2025-03-03', [
      {
        query: 'mocassini uomo',
        page: 'https://example.com/products/mocassini',
        clicks: 99,
        impressions: 999,
        position: 1.5,
      },
    ])

    const [row] = await sql<{ clicks: number; impressions: number; position: number }[]>`
      SELECT clicks, impressions, position
      FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-03' AND query_norm = 'mocassini uomo'
    `
    if (row === undefined) throw new Error('Expected metric row')
    expect(row.clicks).toBe(99)
    expect(row.impressions).toBe(999)
    expect(row.position).toBeCloseTo(1.5)
  })

  it('normalization collision: two raw queries with same query_norm pre-aggregate into one row', async () => {
    // 'Carta Velina' (100 impr) and 'carta velina' (80 impr) both normalize to 'carta velina'
    await persistDate(PROJECT_ID, '2025-03-04', [
      {
        query: 'Carta Velina',
        page: 'https://example.com/products/carta-velina',
        clicks: 50,
        impressions: 100,
        position: 2.0,
      },
      {
        query: 'carta velina',
        page: 'https://example.com/products/carta-velina',
        clicks: 30,
        impressions: 80,
        position: 3.0,
      },
    ])

    const rows = await sql<{ clicks: number; impressions: number; position: number }[]>`
      SELECT clicks, impressions, position
      FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = '2025-03-04'
        AND query_norm = 'carta velina'
        AND page = 'https://example.com/products/carta-velina'
    `
    expect(rows).toHaveLength(1)

    const row = rows[0]
    if (row === undefined) throw new Error('Expected one merged row')
    // clicks and impressions are summed; position is impression-weighted
    expect(row.clicks).toBe(80)
    expect(row.impressions).toBe(180)
    // (2.0 * 100 + 3.0 * 80) / 180 = 440 / 180 ≈ 2.4444
    expect(row.position).toBeCloseTo(440 / 180, 4)
  })

  it('transaction: entire date rolls back if any row violates a constraint', async () => {
    const date = '2025-03-05'

    // Baseline: insert one row that should survive
    await persistDate(PROJECT_ID, date, [
      {
        query: 'baseline query',
        page: 'https://example.com/collections/baseline',
        clicks: 7,
        impressions: 70,
        position: 5.0,
      },
    ])

    // This batch has one valid new row and one invalid row (negative clicks)
    await expect(
      persistDate(PROJECT_ID, date, [
        {
          query: 'valid new query',
          page: 'https://example.com/collections/valid-new',
          clicks: 3,
          impressions: 30,
          position: 4.0,
        },
        {
          query: 'invalid query',
          page: 'https://example.com/collections/invalid',
          clicks: -1, // violates ck_metric_nonneg
          impressions: 30,
          position: 4.0,
        },
      ]),
    ).rejects.toThrow()

    // The valid new row from the failed batch must NOT be in the DB
    const newRow = await sql<{ query_norm: string }[]>`
      SELECT query_norm FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = ${date} AND query_norm = 'valid new query'
    `
    expect(newRow).toHaveLength(0)

    // The baseline row inserted before the failed batch must still be there
    const baseline = await sql<{ clicks: number }[]>`
      SELECT clicks FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = ${date} AND query_norm = 'baseline query'
    `
    expect(baseline).toHaveLength(1)
    const baselineRow = baseline[0]
    if (baselineRow === undefined) throw new Error('Expected baseline row')
    expect(baselineRow.clicks).toBe(7)
  })

  it('large batch: persists >7000 unique rows across multiple INSERT batches', async () => {
    const date = '2025-03-10'
    const ROW_COUNT = 7_500

    const inputRows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      query: `keyword ${i}`,
      page: `https://example.com/products/item-${i}`,
      clicks: 1,
      impressions: 10,
      position: 5.0,
    }))

    await persistDate(PROJECT_ID, date, inputRows)

    const [result] = await sql<{ count: number; total_clicks: number }[]>`
      SELECT COUNT(*)::integer AS count, SUM(clicks)::integer AS total_clicks
      FROM gsc_metric
      WHERE project_id = ${PROJECT_ID} AND date = ${date}
    `
    if (result === undefined) throw new Error('Expected count row')
    expect(result.count).toBe(ROW_COUNT)
    expect(result.total_clicks).toBe(ROW_COUNT)
  }, 30_000)
})
