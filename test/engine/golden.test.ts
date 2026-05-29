import { vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

// Vitest v4 does not auto-inject .env.local; bootstrap it here.
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

const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const WINDOW_START = '2024-02-01'
const WINDOW_END   = '2024-02-07'

// Eurofides-style golden fixture — three distinct cannibalization scenarios.
// All rows share date=WINDOW_START so aggregation is trivial.
const GOLDEN_ROWS = [
  // ── Group 1: base/variant (unknown intent)
  // carta-velina is the base; carta-velina-personalizzata is the personalised variant.
  // isPersonalized XOR=true, Jaccard≈0.667 ≥ 0.5 → benign=base_variant.
  {
    query: 'carta velina', query_norm: 'carta velina',
    page: 'https://example.com/collections/carta-velina',
    page_type: 'collection', clicks: 50, impressions: 500, position: 2.5,
  },
  {
    query: 'carta velina', query_norm: 'carta velina',
    page: 'https://example.com/collections/carta-velina-personalizzata',
    page_type: 'collection', clicks: 30, impressions: 400, position: 3.2,
  },

  // ── Group 2: inversion — winner ≠ dominant (informational intent)
  // Equal clicks; collection has more impressions (tiebreak → collection wins).
  // Blog has better position + high informational prior → blog is dominant.
  // Slugs: {scarpe,running} vs {consigli,allenamento} → no overlap → benign=false.
  {
    query: 'guida corsa', query_norm: 'guida corsa',
    page: 'https://example.com/collections/scarpe-running',
    page_type: 'collection', clicks: 60, impressions: 600, position: 5.0,
  },
  {
    query: 'guida corsa', query_norm: 'guida corsa',
    page: 'https://example.com/blogs/consigli-allenamento',
    page_type: 'blog', clicks: 60, impressions: 500, position: 2.0,
  },

  // ── Group 3: collection_vs_blog (transactional intent)
  // Slugs: {buste,kraft} vs {packaging,guide} → no overlap → benign=false.
  // Branch 5 of action-table: collection_vs_blog + transactional → interlink_blog_to_collection.
  {
    query: 'acquisto buste kraft', query_norm: 'acquisto buste kraft',
    page: 'https://example.com/collections/buste-kraft',
    page_type: 'collection', clicks: 80, impressions: 800, position: 2.0,
  },
  {
    query: 'acquisto buste kraft', query_norm: 'acquisto buste kraft',
    page: 'https://example.com/blogs/packaging-guide',
    page_type: 'blog', clicks: 30, impressions: 400, position: 5.0,
  },
] as const

function groupKey(projectId: string, queryNorm: string, pages: readonly string[]): string {
  const sorted = [...pages].sort().join(',')
  return createHash('sha256').update(`${projectId}|${queryNorm}|${sorted}`).digest('hex')
}

type GlobalWithPg = typeof globalThis & { _pgClient?: { end: () => Promise<void> } }

import { runDetection } from '../../server/engine/detect'

describe.skipIf(!TEST_DB)('golden: detect orchestrator', () => {
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

    // Insert golden fixture rows (different date from seed data → no interference)
    for (const row of GOLDEN_ROWS) {
      await sql`
        INSERT INTO gsc_metric
          (project_id, date, query, query_norm, page, page_type, clicks, impressions, position)
        VALUES
          (${PROJECT_ID}, ${WINDOW_START}::date, ${row.query}, ${row.query_norm},
           ${row.page}, ${row.page_type}, ${row.clicks}, ${row.impressions}, ${row.position})
        ON CONFLICT DO NOTHING
      `
    }
  }, 30_000)

  afterAll(async () => {
    const g = globalThis as GlobalWithPg
    await g._pgClient?.end()
    delete g['_pgClient']
    await sql.end()
  })

  // ── Run 1: basic assertions ──────────────────────────────────────────────────

  it('produces exactly 3 groups and records a succeeded run', async () => {
    const result = await runDetection(PROJECT_ID, WINDOW_START, WINDOW_END)
    expect(result.groupsFound).toBe(3)

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM cannibalization_group WHERE project_id = ${PROJECT_ID}
    `
    expect(count).toBe(3)

    const [run] = await sql<{ status: string; groups_found: number }[]>`
      SELECT status, groups_found FROM detection_run
      WHERE project_id = ${PROJECT_ID}
      ORDER BY started_at DESC LIMIT 1
    `
    expect(run?.status).toBe('succeeded')
    expect(run?.groups_found).toBe(3)
  })

  it('groups are stored ordered by severity desc', async () => {
    const rows = await sql<{ severity: number }[]>`
      SELECT severity FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID}
      ORDER BY severity DESC
    `
    expect(rows.length).toBe(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.severity).toBeGreaterThanOrEqual(rows[i]!.severity)
    }
  })

  it('base/variant group: benign=true reason=base_variant action=differentiate_variant_onpage', async () => {
    const [row] = await sql<{
      benign: boolean
      benign_reason: string
      recommended_action: string
      inversion: boolean
    }[]>`
      SELECT benign, benign_reason, recommended_action, inversion
      FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID} AND query_norm = 'carta velina'
    `
    expect(row).toBeDefined()
    expect(row!.benign).toBe(true)
    expect(row!.benign_reason).toBe('base_variant')
    expect(row!.recommended_action).toBe('differentiate_variant_onpage')
    expect(row!.inversion).toBe(false)
  })

  it('inversion group: inversion=true action=reposition_collection_strengthen_blog', async () => {
    const [row] = await sql<{
      inversion: boolean
      recommended_action: string
      winner_page: string
      dominant_page: string
    }[]>`
      SELECT inversion, recommended_action, winner_page, dominant_page
      FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID} AND query_norm = 'guida corsa'
    `
    expect(row).toBeDefined()
    expect(row!.inversion).toBe(true)
    expect(row!.winner_page).toBe('https://example.com/collections/scarpe-running')
    expect(row!.dominant_page).toBe('https://example.com/blogs/consigli-allenamento')
    expect(row!.recommended_action).toBe('reposition_collection_strengthen_blog')
  })

  it('collection_vs_blog group: benign=false action=interlink_blog_to_collection', async () => {
    const [row] = await sql<{
      cann_type: string
      recommended_action: string
      benign: boolean
      query_intent: string
    }[]>`
      SELECT cann_type, recommended_action, benign, query_intent
      FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID} AND query_norm = 'acquisto buste kraft'
    `
    expect(row).toBeDefined()
    expect(row!.cann_type).toBe('collection_vs_blog')
    expect(row!.query_intent).toBe('transactional')
    expect(row!.benign).toBe(false)
    expect(row!.recommended_action).toBe('interlink_blog_to_collection')
  })

  // ── Run 2: idempotency + group_state survival ────────────────────────────────

  it('run 2: same group_keys, no duplicates, group_state survives', async () => {
    const keysBefore = await sql<{ group_key: string }[]>`
      SELECT group_key FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID}
      ORDER BY group_key
    `

    // Simulate user triage on the inversion group before the second run
    const [invGrp] = await sql<{ group_key: string }[]>`
      SELECT group_key FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID} AND query_norm = 'guida corsa'
    `
    expect(invGrp).toBeDefined()
    const invKey = invGrp!.group_key

    // Verify computed key matches the formula
    const expectedInvKey = groupKey(PROJECT_ID, 'guida corsa', [
      'https://example.com/blogs/consigli-allenamento',
      'https://example.com/collections/scarpe-running',
    ])
    expect(invKey).toBe(expectedInvKey)

    await sql`
      INSERT INTO group_state (project_id, group_key, status, notes)
      VALUES (${PROJECT_ID}, ${invKey}, 'in_progress', 'under review')
      ON CONFLICT DO NOTHING
    `

    const result2 = await runDetection(PROJECT_ID, WINDOW_START, WINDOW_END)
    expect(result2.groupsFound).toBe(3)

    // Same group_keys in same order
    const keysAfter = await sql<{ group_key: string }[]>`
      SELECT group_key FROM cannibalization_group
      WHERE project_id = ${PROJECT_ID}
      ORDER BY group_key
    `
    expect(keysAfter.map(r => r.group_key)).toEqual(keysBefore.map(r => r.group_key))

    // No duplicates
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM cannibalization_group WHERE project_id = ${PROJECT_ID}
    `
    expect(count).toBe(3)

    // group_state survives (detect.ts must not touch group_state)
    const [state] = await sql<{ status: string; notes: string | null }[]>`
      SELECT status, notes FROM group_state
      WHERE project_id = ${PROJECT_ID} AND group_key = ${invKey}
    `
    expect(state?.status).toBe('in_progress')
    expect(state?.notes).toBe('under review')
  })
})
