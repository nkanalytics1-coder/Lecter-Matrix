import { describe, it, expect } from 'vitest'
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  GscConnectSchema,
  SyncSchema,
  DetectSchema,
  UpdateGroupStateSchema,
  GroupFilterSchema,
  GroupListQuerySchema,
} from '../../src/contracts/schemas/requests'

// ── CreateProject ─────────────────────────────────────────────────────────────

describe('CreateProjectSchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(CreateProjectSchema.safeParse({
      name: 'My Shop',
      gscProperty: 'example.com',
      propertyType: 'domain',
    }).success).toBe(true)
  })

  it('accepts an optional timezone', () => {
    expect(CreateProjectSchema.safeParse({
      name: 'My Shop',
      gscProperty: 'example.com',
      propertyType: 'domain',
      timezone: 'Europe/Rome',
    }).success).toBe(true)
  })

  it('rejects an invalid propertyType enum', () => {
    expect(CreateProjectSchema.safeParse({
      name: 'My Shop',
      gscProperty: 'example.com',
      propertyType: 'subdomain',
    }).success).toBe(false)
  })

  it('rejects a name that exceeds 200 chars', () => {
    expect(CreateProjectSchema.safeParse({
      name: 'a'.repeat(201),
      gscProperty: 'example.com',
      propertyType: 'domain',
    }).success).toBe(false)
  })

  it('rejects a gscProperty shorter than 3 chars', () => {
    expect(CreateProjectSchema.safeParse({
      name: 'My Shop',
      gscProperty: 'ab',
      propertyType: 'domain',
    }).success).toBe(false)
  })
})

// ── UpdateProject ─────────────────────────────────────────────────────────────

describe('UpdateProjectSchema', () => {
  it('accepts a single field update', () => {
    expect(UpdateProjectSchema.safeParse({ name: 'New Name' }).success).toBe(true)
  })

  it('accepts multiple field updates', () => {
    expect(UpdateProjectSchema.safeParse({
      name: 'New Name',
      status: 'paused',
      config: { foo: 'bar' },
    }).success).toBe(true)
  })

  it('rejects an empty object (no fields)', () => {
    expect(UpdateProjectSchema.safeParse({}).success).toBe(false)
  })

  it('rejects status "error" (system-set only)', () => {
    expect(UpdateProjectSchema.safeParse({ status: 'error' }).success).toBe(false)
  })
})

// ── GscConnect ────────────────────────────────────────────────────────────────

describe('GscConnectSchema', () => {
  it('accepts a valid code and redirectUri', () => {
    expect(GscConnectSchema.safeParse({
      code: '4/0AbcdefghijklmnopqrstuvwxyzABCDEFG',
      redirectUri: 'https://example.com/callback',
    }).success).toBe(true)
  })

  it('rejects a code shorter than 10 chars', () => {
    expect(GscConnectSchema.safeParse({
      code: 'short',
      redirectUri: 'https://example.com/callback',
    }).success).toBe(false)
  })

  it('rejects a non-URL redirectUri', () => {
    expect(GscConnectSchema.safeParse({
      code: '4/0AbcdefghijkK',
      redirectUri: 'not-a-url',
    }).success).toBe(false)
  })
})

// ── Sync ──────────────────────────────────────────────────────────────────────

describe('SyncSchema', () => {
  it('defaults mode to incremental when absent', () => {
    const result = SyncSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.mode).toBe('incremental')
  })

  it('accepts backfill mode with valid backfillDays', () => {
    expect(SyncSchema.safeParse({ mode: 'backfill', backfillDays: 90 }).success).toBe(true)
  })

  it('coerces backfillDays from string', () => {
    const result = SyncSchema.safeParse({ mode: 'backfill', backfillDays: '30' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.backfillDays).toBe(30)
  })

  it('rejects backfillDays > 480', () => {
    expect(SyncSchema.safeParse({ mode: 'backfill', backfillDays: 481 }).success).toBe(false)
  })

  it('rejects invalid mode enum', () => {
    expect(SyncSchema.safeParse({ mode: 'full' }).success).toBe(false)
  })
})

// ── Detect ────────────────────────────────────────────────────────────────────

describe('DetectSchema', () => {
  it('accepts an empty payload', () => {
    expect(DetectSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a valid date window', () => {
    expect(DetectSchema.safeParse({
      windowStart: '2026-01-01',
      windowEnd:   '2026-03-31',
    }).success).toBe(true)
  })

  it('accepts equal start and end dates', () => {
    expect(DetectSchema.safeParse({
      windowStart: '2026-01-01',
      windowEnd:   '2026-01-01',
    }).success).toBe(true)
  })

  it('rejects an inverted window (start > end)', () => {
    expect(DetectSchema.safeParse({
      windowStart: '2026-03-31',
      windowEnd:   '2026-01-01',
    }).success).toBe(false)
  })

  it('rejects an invalid date string', () => {
    expect(DetectSchema.safeParse({
      windowStart: 'not-a-date',
    }).success).toBe(false)
  })
})

// ── UpdateGroupState ──────────────────────────────────────────────────────────

describe('UpdateGroupStateSchema', () => {
  it('accepts a status-only update', () => {
    expect(UpdateGroupStateSchema.safeParse({ status: 'in_progress' }).success).toBe(true)
  })

  it('accepts a notes-only update (null clears the note)', () => {
    expect(UpdateGroupStateSchema.safeParse({ notes: null }).success).toBe(true)
  })

  it('accepts a notes string update', () => {
    expect(UpdateGroupStateSchema.safeParse({ notes: 'Needs review' }).success).toBe(true)
  })

  it('rejects an empty object (no fields)', () => {
    expect(UpdateGroupStateSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an invalid status enum', () => {
    expect(UpdateGroupStateSchema.safeParse({ status: 'done' }).success).toBe(false)
  })
})

// ── GroupFilter ───────────────────────────────────────────────────────────────

describe('GroupFilterSchema', () => {
  it('accepts an empty filter', () => {
    expect(GroupFilterSchema.safeParse({}).success).toBe(true)
  })

  it('parses CSV severityBand string into an array', () => {
    const result = GroupFilterSchema.safeParse({ severityBand: 'critical,high' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.severityBand).toEqual(['critical', 'high'])
  })

  it('parses repeated cannType param (array input) into an array', () => {
    const result = GroupFilterSchema.safeParse({ cannType: ['collection_vs_collection', 'blog_vs_blog'] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cannType).toEqual(['collection_vs_collection', 'blog_vs_blog'])
  })

  it('parses CSV with spaces correctly', () => {
    const result = GroupFilterSchema.safeParse({ intent: 'informational, transactional' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.intent).toEqual(['informational', 'transactional'])
  })

  it('rejects an invalid severityBand value', () => {
    expect(GroupFilterSchema.safeParse({ severityBand: 'extreme' }).success).toBe(false)
  })

  it('rejects an invalid cannType inside a CSV list', () => {
    expect(GroupFilterSchema.safeParse({ cannType: 'collection_vs_collection,invalid_type' }).success).toBe(false)
  })

  it('coerces inversionOnly from string "true"', () => {
    const result = GroupFilterSchema.safeParse({ inversionOnly: 'true' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.inversionOnly).toBe(true)
  })

  it('coerces severityMin from string', () => {
    const result = GroupFilterSchema.safeParse({ severityMin: '70' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.severityMin).toBe(70)
  })

  it('rejects severityMin above 100', () => {
    expect(GroupFilterSchema.safeParse({ severityMin: 101 }).success).toBe(false)
  })
})

// ── GroupListQuery ─────────────────────────────────────────────────────────────

describe('GroupListQuerySchema', () => {
  it('applies defaults for limit and sort', () => {
    const result = GroupListQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(50)
      expect(result.data.sort).toBe('severity:desc')
    }
  })

  it('accepts a valid sort field and direction', () => {
    expect(GroupListQuerySchema.safeParse({ sort: 'lostClicks:asc' }).success).toBe(true)
  })

  it('rejects an unknown sort field', () => {
    expect(GroupListQuerySchema.safeParse({ sort: 'ctr:asc' }).success).toBe(false)
  })

  it('rejects an invalid sort direction', () => {
    expect(GroupListQuerySchema.safeParse({ sort: 'severity:ascending' }).success).toBe(false)
  })

  it('coerces limit from string', () => {
    const result = GroupListQuerySchema.safeParse({ limit: '20' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(20)
  })

  it('rejects limit > 100', () => {
    expect(GroupListQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
  })

  it('inherits filter fields from GroupFilterSchema', () => {
    const result = GroupListQuerySchema.safeParse({
      severityBand: 'critical',
      inversionOnly: 'true',
      sort: 'impressions:desc',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.severityBand).toEqual(['critical'])
      expect(result.data.inversionOnly).toBe(true)
    }
  })
})
