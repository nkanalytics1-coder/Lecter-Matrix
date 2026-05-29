import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// mockSortValue is read lazily each time useQueryState() is called, so
// changing it between tests controls what the component sees.
let mockSortValue = 'severity:desc'

vi.mock('nuqs', () => ({
  parseAsString: { withDefault: () => ({}) },
  useQueryState: vi.fn(() => [mockSortValue, vi.fn()] as const),
}))

import {
  computeNextSort,
  DEFAULT_SORT,
  getAriaSort,
} from '@/components/grid/DataTable'
import { formatNullable } from '@/components/grid/Cell'
import DataTable from '@/components/grid/DataTable'
import type { DataTableColumn } from '@/components/grid/Cell'

// ─── Fixtures ────────────────────────────────────────────────────────────────

type TestRow = { query: string; clicks: number | null; active: boolean }

const cols: DataTableColumn<TestRow>[] = [
  {
    id: 'query',
    header: 'Query',
    accessor: 'query',
    sortable: true,
    sortField: 'severity',
    widthHint: 200,
    pinLeft: true,
  },
  {
    id: 'clicks',
    header: 'Click',
    accessor: 'clicks',
    sortable: false,
    widthHint: 100,
    render: 'metric',
  },
]

const rows: TestRow[] = [
  { query: 'scarpe uomo', clicks: 1200, active: true },
  { query: 'stivali donna', clicks: null, active: false },
]

function renderTable(opts: { hasMore?: boolean; sort?: string } = {}) {
  mockSortValue = opts.sort ?? 'severity:desc'
  return renderToString(
    <DataTable
      columns={cols}
      rows={rows}
      onLoadMore={() => void 0}
      hasMore={opts.hasMore ?? true}
    />,
  )
}

// ─── computeNextSort ─────────────────────────────────────────────────────────

describe('computeNextSort', () => {
  it('clicking a different field → field:desc', () => {
    expect(computeNextSort('impressions', 'severity:desc')).toBe('impressions:desc')
  })

  it('clicking the current field when desc → field:asc', () => {
    expect(computeNextSort('severity', 'severity:desc')).toBe('severity:asc')
  })

  it('clicking the current field when asc → DEFAULT_SORT', () => {
    expect(computeNextSort('severity', 'severity:asc')).toBe(DEFAULT_SORT)
  })

  it('clicking lostClicks with no sort on it → lostClicks:desc', () => {
    expect(computeNextSort('lostClicks', 'severity:desc')).toBe('lostClicks:desc')
  })
})

// ─── getAriaSort ──────────────────────────────────────────────────────────────

describe('getAriaSort', () => {
  it('returns ascending when column is sorted asc', () => {
    expect(getAriaSort('severity', true, 'severity:asc')).toBe('ascending')
  })

  it('returns descending when column is sorted desc', () => {
    expect(getAriaSort('severity', true, 'severity:desc')).toBe('descending')
  })

  it('returns none when a different field is sorted', () => {
    expect(getAriaSort('impressions', true, 'severity:desc')).toBe('none')
  })

  it('returns none for a non-sortable column', () => {
    expect(getAriaSort(undefined, false, 'severity:desc')).toBe('none')
  })
})

// ─── formatNullable ───────────────────────────────────────────────────────────

describe('formatNullable', () => {
  it('maps null to em-dash', () => {
    expect(formatNullable(null)).toBe('—')
  })

  it('maps undefined to em-dash', () => {
    expect(formatNullable(undefined)).toBe('—')
  })

  it('does not map 0 to em-dash', () => {
    expect(formatNullable(0)).toBe('0')
  })
})

// ─── Render: generic table ────────────────────────────────────────────────────

describe('DataTable render', () => {
  it('renders a role=grid element', () => {
    const html = renderTable()
    expect(html).toContain('role="grid"')
  })

  it('renders role=row for header + data rows + load-more row', () => {
    const html = renderTable()
    const matches = html.match(/role="row"/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(rows.length + 1)
  })

  it('renders role=columnheader for each column', () => {
    const html = renderTable()
    const matches = html.match(/role="columnheader"/g) ?? []
    expect(matches).toHaveLength(cols.length)
  })

  it('renders — for a null metric value', () => {
    const html = renderTable()
    expect(html).toContain('—')
  })
})

// ─── aria-sort ────────────────────────────────────────────────────────────────

describe('aria-sort on column headers', () => {
  it('sets aria-sort="descending" for the active desc column', () => {
    const html = renderTable({ sort: 'severity:desc' })
    expect(html).toContain('aria-sort="descending"')
  })

  it('sets aria-sort="ascending" for the active asc column', () => {
    const html = renderTable({ sort: 'severity:asc' })
    expect(html).toContain('aria-sort="ascending"')
  })

  it('sets aria-sort="none" when the sort field does not match any column', () => {
    const html = renderTable({ sort: 'impressions:desc' })
    expect(html).toContain('aria-sort="none"')
  })
})

// ─── Load more button ─────────────────────────────────────────────────────────

describe('Load more button', () => {
  it('is not disabled when hasMore=true', () => {
    const html = renderTable({ hasMore: true })
    const btn = html.match(/<button[^>]*>Carica altri<\/button>/)
    expect(btn).not.toBeNull()
    // disabled HTML attribute is " disabled" or "disabled=" — not just the word in a class
    expect(btn![0]).not.toMatch(/ disabled[= >]/)
  })

  it('is disabled when hasMore=false', () => {
    const html = renderTable({ hasMore: false })
    const btn = html.match(/<button[^>]*>Carica altri<\/button>/)
    expect(btn).not.toBeNull()
    expect(btn![0]).toMatch(/ disabled[= >]/)
  })
})
