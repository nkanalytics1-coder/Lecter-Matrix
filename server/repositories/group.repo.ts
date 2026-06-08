import 'server-only'
import { bqQuery, bqTable } from '../db/bq-client'
import type { BqParamTypes } from '../db/bq-client'
import { bqTimestampToISO } from '../db/bq-helpers'
import { encodeCursor, decodeCursor } from '../../src/contracts/lib/contract-utils'
import type { GroupListQuery } from '../../src/contracts/schemas/requests'
import type { CannibalizationGroupDTO, GroupMemberDTO } from '../../src/contracts/types/entities'
import type { Paginated } from '../../src/contracts/types/api'
import type {
  CannType,
  GroupStatus,
  Intent,
  SeverityBand,
  PageType,
  RecommendedAction,
} from '../../src/contracts/types/domain'
import type { GroupFilter } from '../../src/contracts/schemas/requests'

// ── Severity helpers ───────────────────────────────────────────────────────────

// severity_score is the raw numeric score (0–100) from scoring.ts; the band is
// derived here, never stored. Thresholds: critical ≥70, high ≥50, medium ≥30, low <30.
function severityBandFromScore(score: number): SeverityBand {
  if (score >= 70) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ListRow {
  group_key: string
  query_norm: string
  query_intent: string
  search_volume: string | null // BQ INT64 as string, nullable
  cann_type: string
  total_clicks: string         // BQ INT64 as string
  total_impressions: string    // BQ INT64 as string
  member_count: string         // BQ INT64 as string
  severity_score: number       // BQ FLOAT64
  winner_page: string | null
  should_win_page: string | null
  inversion: boolean
  benign: boolean
  benign_reason: string | null
  recommended_action: string
  lost_clicks: string          // BQ INT64 as string
  detected_at: unknown
  gs_status: string | null
  gs_notes: string | null
}

interface MemberStruct {
  page: string
  page_type: string
  clicks: string
  impressions: string
  position: number
  is_winner: boolean
}

interface DrillRow extends ListRow {
  members: MemberStruct[] | null
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function rowToDTO(row: ListRow, members?: GroupMemberDTO[]): CannibalizationGroupDTO {
  const dto: CannibalizationGroupDTO = {
    id: row.group_key,
    groupKey: row.group_key,
    queryNorm: row.query_norm,
    queryIntent: row.query_intent as Intent,
    searchVolume: row.search_volume !== null ? Number(row.search_volume) : null,
    cannType: row.cann_type as CannType,
    totalClicks: Number(row.total_clicks),
    totalImpressions: Number(row.total_impressions),
    memberCount: Number(row.member_count),
    severity: row.severity_score,
    severityBand: severityBandFromScore(row.severity_score),
    winnerPage: row.winner_page,
    dominantPage: row.should_win_page,
    inversion: row.inversion,
    benign: row.benign,
    benignReason: row.benign_reason,
    recommendedAction: row.recommended_action as RecommendedAction,
    lostClicks: Number(row.lost_clicks),
    state: row.gs_status !== null
      ? { status: row.gs_status as GroupStatus, notes: row.gs_notes }
      : null,
    updatedAt: bqTimestampToISO(row.detected_at) as string,
  }
  if (members !== undefined) dto.members = members
  return dto
}

function memberToDTO(m: MemberStruct): GroupMemberDTO {
  return {
    page: m.page,
    pageType: m.page_type as PageType,
    clicks: Number(m.clicks),
    impressions: Number(m.impressions),
    position: m.position,
    isWinner: m.is_winner,
  }
}

// ── Shared SELECT / JOIN fragment ──────────────────────────────────────────────

function groupSelectSql(whereClause: string): string {
  return `
    SELECT
      g.group_key, g.query_norm, g.query_intent, g.search_volume, g.cann_type,
      g.total_clicks, g.total_impressions, g.member_count, g.severity_score,
      g.winner_page, g.should_win_page, g.inversion, g.benign, g.benign_reason,
      g.recommended_action, g.lost_clicks, g.detected_at,
      gs.state AS gs_status,
      gs.note  AS gs_notes
    FROM ${bqTable('cannibalization_group')} g
    LEFT JOIN ${bqTable('group_state')} gs
      ON gs.project_id = g.project_id AND gs.group_key = g.group_key
    ${whereClause}
  `
}

// ── List query builder ─────────────────────────────────────────────────────────

// Whitelisted sort-field → BQ expression
const SORT_EXPR: Record<string, string> = {
  severity:    'g.severity_score',
  impressions: 'CAST(g.total_impressions AS INT64)',
  lostClicks:  'CAST(g.lost_clicks AS INT64)',
}

interface FilterResult {
  ands: string[]
  params: Record<string, unknown>
  types: BqParamTypes
}

function buildFilterAnds(filter: GroupFilter, baseParams: Record<string, unknown>): FilterResult {
  const ands: string[] = []
  const params: Record<string, unknown> = { ...baseParams }
  const types: BqParamTypes = {}

  if (filter.severityBand?.length) {
    // Bands are derived from severity_score (not stored): expand each to a range predicate.
    ands.push(`(${filter.severityBand.map(b => `(${bandScorePredicate(b)})`).join(' OR ')})`)
  }
  if (filter.severityMin !== undefined) {
    params['severity_min'] = filter.severityMin
    ands.push('g.severity_score >= @severity_min')
  }
  if (filter.cannType?.length) {
    params['cann_type'] = filter.cannType
    types['cann_type'] = ['STRING']
    ands.push('g.cann_type IN UNNEST(@cann_type)')
  }
  if (filter.intent?.length) {
    params['query_intent'] = filter.intent
    types['query_intent'] = ['STRING']
    ands.push('g.query_intent IN UNNEST(@query_intent)')
  }
  if (filter.status?.length) {
    params['gs_status'] = filter.status
    types['gs_status'] = ['STRING']
    ands.push("COALESCE(gs.state, 'open') IN UNNEST(@gs_status)")
  }
  if (filter.pathPrefix) {
    params['path_prefix'] = filter.pathPrefix
    ands.push(`EXISTS (
      SELECT 1 FROM ${bqTable('cannibalization_member')} cm
      WHERE cm.project_id = g.project_id AND cm.group_key = g.group_key
        AND STARTS_WITH(cm.page, @path_prefix)
    )`)
  }
  if (filter.inversionOnly) ands.push('g.inversion = TRUE')
  if (filter.hideBenign) ands.push('g.benign = FALSE')
  if (filter.q) {
    const esc = filter.q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    params['q_pattern'] = '%' + esc + '%'
    ands.push("LOWER(g.query_norm) LIKE LOWER(@q_pattern) ESCAPE '\\\\'")
  }

  return { ands, params, types }
}

// SQL predicate for a single severity band, derived from severity_score.
function bandScorePredicate(band: string): string {
  switch (band) {
    case 'critical': return 'g.severity_score >= 70'
    case 'high':     return 'g.severity_score >= 50 AND g.severity_score < 70'
    case 'medium':   return 'g.severity_score >= 30 AND g.severity_score < 50'
    case 'low':      return 'g.severity_score < 30'
    default:         return 'FALSE'
  }
}

function buildListSql(
  projectId: string,
  query: GroupListQuery,
): { sqlStr: string; params: Record<string, unknown>; types: BqParamTypes } {
  const [rawField = 'severity', rawDir = 'desc'] = query.sort.split(':')
  const colExpr = SORT_EXPR[rawField] ?? SORT_EXPR['severity']!
  const dir = rawDir === 'asc' ? 'ASC' : 'DESC'
  const cmp = dir === 'DESC' ? '<' : '>'

  const { ands, params, types } = buildFilterAnds(query, { project_id: projectId })

  const cursor = decodeCursor(query.cursor)
  if (cursor !== null) {
    params['cursor_sort'] = cursor.sortValue
    params['cursor_id'] = cursor.id
    // BQ expanded tuple comparison: (a < b) OR (a = b AND key < key_b)
    ands.push(`(
      (${colExpr}) ${cmp} @cursor_sort
      OR ((${colExpr}) = @cursor_sort AND g.group_key ${cmp} @cursor_id)
    )`)
  }

  params['limit_plus_one'] = query.limit + 1

  const whereStr = ['WHERE g.project_id = @project_id']
    .concat(ands.map(a => `AND ${a}`))
    .join('\n    ')

  const sqlStr = `
    ${groupSelectSql(whereStr)}
    ORDER BY (${colExpr}) ${dir}, g.group_key ${dir}
    LIMIT @limit_plus_one
  `
  return { sqlStr, params, types }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function listGroups(
  projectId: string,
  query: GroupListQuery,
): Promise<Paginated<CannibalizationGroupDTO>> {
  const { sqlStr, params, types } = buildListSql(projectId, query)
  const rows = await bqQuery<ListRow>(sqlStr, params, types)

  const hasNext = rows.length > query.limit
  const kept = hasNext ? rows.slice(0, query.limit) : rows

  const [rawField = 'severity'] = query.sort.split(':')

  let nextCursor: string | null = null
  if (hasNext && kept.length > 0) {
    const last = kept[kept.length - 1]!
    let sortValue: number
    if (rawField === 'impressions') {
      sortValue = Number(last.total_impressions)
    } else if (rawField === 'lostClicks') {
      sortValue = Number(last.lost_clicks)
    } else {
      sortValue = last.severity_score
    }
    nextCursor = encodeCursor({ sortValue, id: last.group_key })
  }

  return {
    items: kept.map(r => rowToDTO(r)),
    nextCursor,
    pageSize: kept.length,
  }
}

export async function exportGroups(
  projectId: string,
  filter: GroupFilter,
): Promise<CannibalizationGroupDTO[]> {
  const { ands, params, types } = buildFilterAnds(filter, { project_id: projectId })
  const whereStr = ['WHERE g.project_id = @project_id']
    .concat(ands.map(a => `AND ${a}`))
    .join('\n    ')
  const sqlStr = `
    ${groupSelectSql(whereStr)}
    ORDER BY g.severity_score DESC, g.group_key DESC
  `
  const rows = await bqQuery<ListRow>(sqlStr, params, types)
  return rows.map(r => rowToDTO(r))
}

export async function getGroupDrill(
  projectId: string,
  groupKey: string,
): Promise<CannibalizationGroupDTO | null> {
  const rows = await bqQuery<DrillRow>(
    `
    SELECT
      g.group_key, g.query_norm, g.query_intent, g.search_volume, g.cann_type,
      g.total_clicks, g.total_impressions, g.member_count, g.severity_score,
      g.winner_page, g.should_win_page, g.inversion, g.benign, g.benign_reason,
      g.recommended_action, g.lost_clicks, g.detected_at,
      gs.state AS gs_status,
      gs.note  AS gs_notes,
      IFNULL(
        ARRAY_AGG(
          IF(cm.page IS NOT NULL,
            STRUCT(
              cm.page        AS page,
              cm.page_type   AS page_type,
              cm.clicks      AS clicks,
              cm.impressions AS impressions,
              cm.weighted_position AS position,
              cm.is_winner   AS is_winner
            ),
            NULL
          ) IGNORE NULLS
          ORDER BY cm.is_winner DESC, cm.impressions DESC
        ),
        []
      ) AS members
    FROM ${bqTable('cannibalization_group')} g
    LEFT JOIN ${bqTable('group_state')} gs
      ON gs.project_id = g.project_id AND gs.group_key = g.group_key
    LEFT JOIN ${bqTable('cannibalization_member')} cm
      ON cm.project_id = g.project_id AND cm.group_key = g.group_key
    WHERE g.project_id = @project_id AND g.group_key = @group_key
    GROUP BY
      g.group_key, g.query_norm, g.query_intent, g.search_volume, g.cann_type,
      g.total_clicks, g.total_impressions, g.member_count, g.severity_score,
      g.winner_page, g.should_win_page, g.inversion, g.benign, g.benign_reason,
      g.recommended_action, g.lost_clicks, g.detected_at,
      gs_status, gs_notes
    LIMIT 1
    `,
    { project_id: projectId, group_key: groupKey },
  )

  const row = rows[0]
  if (row === undefined) return null
  const members = (row.members ?? []).map(memberToDTO)
  return rowToDTO(row, members)
}
