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
const ROOT = process.cwd()
const MIGRATIONS = [
  '0001_extensions.sql',
  '0002_projects.sql',
  '0003_fact.sql',
  '0004_results.sql',
]

import { listGroups, getGroupDrill } from '../../server/repositories/group.repo'

const PROJECT_ID = '00000000-0000-0000-0000-000000000002'

type GlobalWithPg = typeof globalThis & { _pgClient?: { end: () => Promise<void> } }

describe.skipIf(!TEST_DB)('group.repo', () => {
  let sql!: ReturnType<typeof postgres>

  // Inserted group IDs for teardown-safe reference
  const insertedGroupIds: string[] = []

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

    // Seed the test project
    await sql`
      INSERT INTO project (id, name, gsc_property, property_type)
      VALUES (
        ${PROJECT_ID},
        'Repo Test Site',
        'sc-domain:repotestsite.com',
        'domain'
      )
    `

    // Insert 5 groups with deliberate severity layout:
    //   G1: severity=80  (critical)
    //   G2: severity=75  (critical)  ← same severity band as G1, different id → tiebreak test
    //   G3: severity=75  (critical)  ← same severity as G2 → tests that tiebreak on id
    //   G4: severity=55  (high)
    //   G5: severity=20  (low), inversion=true
    // G3.id > G2.id by insertion order, so ORDER BY severity DESC, id DESC → G3 before G2.
    const groups = await sql<{ id: string }[]>`
      INSERT INTO cannibalization_group
        (project_id, group_key, query_norm, cann_type, total_clicks, total_impressions,
         member_count, severity, recommended_action, inversion, lost_clicks)
      VALUES
        (${PROJECT_ID}, ${'gk-1'}, ${'query one'},   ${'blog_vs_blog'},                  100, 1000, 2, 80, ${'differentiate_onpage'},                   false, 10),
        (${PROJECT_ID}, ${'gk-2'}, ${'query two'},   ${'collection_vs_collection'},      80,  800,  2, 75, ${'consolidate_301'},                        false, 20),
        (${PROJECT_ID}, ${'gk-3'}, ${'query three'}, ${'collection_vs_blog'},            60,  600,  2, 75, ${'interlink_blog_to_collection'},           false, 30),
        (${PROJECT_ID}, ${'gk-4'}, ${'query four'},  ${'collection_vs_collection'},      40,  400,  2, 55, ${'differentiate_variant_onpage'},           false, 40),
        (${PROJECT_ID}, ${'gk-5'}, ${'query five'},  ${'blog_vs_blog'},                  20,  200,  2, 20, ${'reduce_blog_overlap_or_canonical'},       true,  5)
      RETURNING id::text AS id
    `
    insertedGroupIds.push(...groups.map(r => r.id))

    // Insert members for every group (needed for drill + pathPrefix filter)
    for (const gid of insertedGroupIds) {
      await sql`
        INSERT INTO cannibalization_member (group_id, page, page_type, clicks, impressions, position, is_winner)
        VALUES
          (${gid}::bigint, ${'https://example.com/collections/a'}, ${'collection'}, 60, 600, 3.0, true),
          (${gid}::bigint, ${'https://example.com/blogs/b'},        ${'blog'},       40, 400, 5.0, false)
      `
    }

    // Add a group_state row for G5 so status filter can be tested
    await sql`
      INSERT INTO group_state (project_id, group_key, status, notes)
      VALUES (${PROJECT_ID}, ${'gk-5'}, ${'ignored'}, ${'test note'})
    `
  }, 30_000)

  afterAll(async () => {
    const g = globalThis as GlobalWithPg
    await g._pgClient?.end()
    delete g['_pgClient']
    await sql.end()
  })

  // ── listGroups: basic page 1 ─────────────────────────────────────────────

  it('returns first page sorted by severity DESC with correct count', async () => {
    const result = await listGroups(PROJECT_ID, {
      limit: 3,
      sort: 'severity:desc',
    })

    expect(result.items).toHaveLength(3)
    expect(result.pageSize).toBe(3)
    expect(result.nextCursor).not.toBeNull()

    // Must be ordered severity DESC
    const severities = result.items.map(i => i.severity)
    expect(severities[0]).toBeGreaterThanOrEqual(severities[1]!)
    expect(severities[1]).toBeGreaterThanOrEqual(severities[2]!)
  })

  // ── listGroups: two groups with the same severity — tiebreak on id ────────

  it('tiebreaks on id so that same-severity groups never duplicate or skip across pages', async () => {
    // Page 1: limit=2 → gets the top-2 groups (severity 80 and one of the 75s)
    const page1 = await listGroups(PROJECT_ID, { limit: 2, sort: 'severity:desc' })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()

    // Page 2 via cursor
    const page2 = await listGroups(PROJECT_ID, {
      limit: 2,
      sort: 'severity:desc',
      cursor: page1.nextCursor!,
    })
    expect(page2.items).toHaveLength(2)
    expect(page2.nextCursor).not.toBeNull()

    // Page 3 (last page)
    const page3 = await listGroups(PROJECT_ID, {
      limit: 2,
      sort: 'severity:desc',
      cursor: page2.nextCursor!,
    })
    expect(page3.items).toHaveLength(1)
    expect(page3.nextCursor).toBeNull()

    // Collect all IDs across pages — must be exactly 5 unique groups, no duplicates, no gaps
    const allIds = [
      ...page1.items.map(i => i.id),
      ...page2.items.map(i => i.id),
      ...page3.items.map(i => i.id),
    ]
    expect(allIds).toHaveLength(5)
    expect(new Set(allIds).size).toBe(5)
  })

  // ── listGroups: last page has nextCursor = null ───────────────────────────

  it('last page has nextCursor null when limit equals remaining rows', async () => {
    const result = await listGroups(PROJECT_ID, { limit: 5, sort: 'severity:desc' })
    expect(result.items).toHaveLength(5)
    expect(result.nextCursor).toBeNull()
  })

  // ── listGroups: inversionOnly filter ────────────────────────────────────

  it('inversionOnly filter returns only inverted groups', async () => {
    const result = await listGroups(PROJECT_ID, {
      limit: 50,
      sort: 'severity:desc',
      inversionOnly: true,
    })

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(item.inversion).toBe(true)
    }
  })

  // ── listGroups: status filter ────────────────────────────────────────────

  it('status filter returns only groups matching the given status', async () => {
    const result = await listGroups(PROJECT_ID, {
      limit: 50,
      sort: 'severity:desc',
      status: ['ignored'],
    })

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(item.state?.status).toBe('ignored')
    }
  })

  // ── listGroups: severityMin filter ──────────────────────────────────────

  it('severityMin filter excludes groups below the threshold', async () => {
    const result = await listGroups(PROJECT_ID, {
      limit: 50,
      sort: 'severity:desc',
      severityMin: 60,
    })

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(item.severity).toBeGreaterThanOrEqual(60)
    }
  })

  // ── listGroups: cannType filter ──────────────────────────────────────────

  it('cannType filter returns only matching cann types', async () => {
    const result = await listGroups(PROJECT_ID, {
      limit: 50,
      sort: 'severity:desc',
      cannType: ['blog_vs_blog'],
    })

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(item.cannType).toBe('blog_vs_blog')
    }
  })

  // ── getGroupDrill: returns group + all members ───────────────────────────

  it('getGroupDrill returns the group with aggregated members', async () => {
    // Get the first group from a list so we have a valid numeric id
    const list = await listGroups(PROJECT_ID, { limit: 1, sort: 'severity:desc' })
    const groupId = list.items[0]!.id

    const drill = await getGroupDrill(groupId)

    expect(drill).not.toBeNull()
    expect(drill!.id).toBe(groupId)
    expect(drill!.members).toBeDefined()
    expect(drill!.members!.length).toBe(2)

    // Winner comes first (is_winner DESC) and has isWinner=true
    const winner = drill!.members!.find(m => m.isWinner)
    expect(winner).toBeDefined()
    expect(winner!.page).toBe('https://example.com/collections/a')
  })

  it('getGroupDrill returns null for non-existent group', async () => {
    const result = await getGroupDrill(999_999_999)
    expect(result).toBeNull()
  })

  // ── getGroupDrill: severityBand derived correctly ────────────────────────

  it('severityBand is derived correctly from severity score', async () => {
    const list = await listGroups(PROJECT_ID, { limit: 50, sort: 'severity:desc' })

    for (const item of list.items) {
      if (item.severity >= 70) expect(item.severityBand).toBe('critical')
      else if (item.severity >= 50) expect(item.severityBand).toBe('high')
      else if (item.severity >= 30) expect(item.severityBand).toBe('medium')
      else expect(item.severityBand).toBe('low')
    }
  })
})
