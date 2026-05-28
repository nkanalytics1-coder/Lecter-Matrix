import 'server-only'
import { serviceClient } from '../db/client'
import { normalizeQuery, classifyPage } from './normalize'

export interface RawMetricRow {
  query: string
  page: string
  clicks: number
  impressions: number
  position: number
}

interface NormalizedRow {
  project_id: string
  date: string
  query: string
  query_norm: string
  page: string
  page_type: string
  clicks: number
  impressions: number
  position: number
}

interface Accumulator {
  project_id: string
  date: string
  query: string
  query_norm: string
  page: string
  page_type: string
  clicks: number
  impressions: number
  posWeightedSum: number
}

// Postgres rejects statements with >65534 parameters; chunk to stay well under the limit.
const COLS_PER_ROW = 9
const BATCH_SIZE = Math.floor(60_000 / COLS_PER_ROW) // ~6666 rows per INSERT

export async function persistDate(
  projectId: string,
  date: string,
  rows: RawMetricRow[],
): Promise<void> {
  if (rows.length === 0) return

  const sql = serviceClient()

  // Pre-aggregate by (query_norm, page): sum clicks/impressions, impression-weighted position
  const byKey = new Map<string, Accumulator>()
  for (const r of rows) {
    const query_norm = normalizeQuery(r.query)
    const key = `${query_norm}\0${r.page}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        project_id: projectId,
        date,
        query: r.query,
        query_norm,
        page: r.page,
        page_type: classifyPage(r.page),
        clicks: r.clicks,
        impressions: r.impressions,
        posWeightedSum: r.position * r.impressions,
      })
    } else {
      existing.clicks += r.clicks
      existing.impressions += r.impressions
      existing.posWeightedSum += r.position * r.impressions
      existing.query = r.query
    }
  }

  const normalized: NormalizedRow[] = Array.from(byKey.values()).map((acc) => ({
    project_id: acc.project_id,
    date: acc.date,
    query: acc.query,
    query_norm: acc.query_norm,
    page: acc.page,
    page_type: acc.page_type,
    clicks: acc.clicks,
    impressions: acc.impressions,
    position: acc.impressions > 0 ? acc.posWeightedSum / acc.impressions : 0,
  }))

  await sql.begin(async (tx) => {
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE)
      await tx`
        INSERT INTO gsc_metric ${tx(batch, 'project_id', 'date', 'query', 'query_norm', 'page', 'page_type', 'clicks', 'impressions', 'position')}
        ON CONFLICT (project_id, date, query_norm, page)
        DO UPDATE SET
          query       = EXCLUDED.query,
          page_type   = EXCLUDED.page_type,
          clicks      = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          position    = EXCLUDED.position
      `
    }
  })
}
