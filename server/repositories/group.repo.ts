import 'server-only'
import { serviceClient } from '../db/client'
import { encodeCursor, decodeCursor } from '../../src/contracts/lib/contract-utils'
import type { GroupListQuery } from '../../src/contracts/schemas/requests'
import type { CannibalizationGroupDTO, GroupMemberDTO } from '../../src/contracts/types/entities'
import type { Paginated } from '../../src/contracts/types/api'
import type {
  Intent,
  CannType,
  GroupStatus,
  SeverityBand,
  PageType,
  RecommendedAction,
} from '../../src/contracts/types/domain'
import type { GroupFilter } from '../../src/contracts/schemas/requests'

// ── Severity band thresholds (per API spec) ────────────────────────────────

function toSeverityBand(severity: number): SeverityBand {
  if (severity >= 70) return 'critical'
  if (severity >= 50) return 'high'
  if (severity >= 30) return 'medium'
  return 'low'
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ListRow {
  id: string
  group_key: string
  query_norm: string
  query_intent: string
  search_volume: number | null
  cann_type: string
  total_clicks: number
  total_impressions: number
  member_count: number
  severity: number
  winner_page: string | null
  dominant_page: string | null
  inversion: boolean
  benign: boolean
  benign_reason: string | null
  recommended_action: string
  lost_clicks: number
  updated_at: Date
  gs_status: string | null
  gs_notes: string | null
}

interface DrillMemberJson {
  page: string
  page_type: string
  clicks: number
  impressions: number
  position: number
  is_winner: boolean
}

interface DrillRow extends ListRow {
  members: DrillMemberJson[]
}

// ── Mappers ────────────────────────────────────────────────────────────────

function rowToDTO(row: ListRow, members?: GroupMemberDTO[]): CannibalizationGroupDTO {
  const dto: CannibalizationGroupDTO = {
    id: parseInt(row.id, 10),
    groupKey: row.group_key,
    queryNorm: row.query_norm,
    queryIntent: row.query_intent as Intent,
    searchVolume: row.search_volume,
    cannType: row.cann_type as CannType,
    totalClicks: row.total_clicks,
    totalImpressions: row.total_impressions,
    memberCount: row.member_count,
    severity: row.severity,
    severityBand: toSeverityBand(row.severity),
    winnerPage: row.winner_page,
    dominantPage: row.dominant_page,
    inversion: row.inversion,
    benign: row.benign,
    benignReason: row.benign_reason,
    recommendedAction: row.recommended_action as RecommendedAction,
    lostClicks: row.lost_clicks,
    state: row.gs_status !== null
      ? { status: row.gs_status as GroupStatus, notes: row.gs_notes }
      : null,
    updatedAt: row.updated_at.toISOString(),
  }
  if (members !== undefined) dto.members = members
  return dto
}

function memberJsonToDTO(m: DrillMemberJson): GroupMemberDTO {
  return {
    page: m.page,
    pageType: m.page_type as PageType,
    clicks: m.clicks,
    impressions: m.impressions,
    position: m.position,
    isWinner: m.is_winner,
  }
}

// ── List query builder ─────────────────────────────────────────────────────

// Severity band → SQL WHERE fragment (no user input, safe to embed)
const BAND_SQL: Record<SeverityBand, string> = {
  critical: 'g.severity >= 70',
  high:     'g.severity >= 50 AND g.severity < 70',
  medium:   'g.severity >= 30 AND g.severity < 50',
  low:      'g.severity < 30',
}

// Whitelisted sort-field → column expression
const SORT_EXPR: Record<string, string> = {
  severity:    'g.severity',
  impressions: 'g.total_impressions',
  lostClicks:  'g.lost_clicks',
}

// Whitelisted sort-field → row key for cursor extraction
const SORT_ROW_KEY: Record<string, keyof ListRow> = {
  severity:    'severity',
  impressions: 'total_impressions',
  lostClicks:  'lost_clicks',
}

// ── Shared SELECT / JOIN fragment ─────────────────────────────────────────────

const GROUP_SELECT = `
  SELECT
    g.id::text, g.group_key, g.query_norm, g.query_intent, g.search_volume,
    g.cann_type, g.total_clicks, g.total_impressions, g.member_count,
    g.severity, g.winner_page, g.dominant_page, g.inversion, g.benign,
    g.benign_reason, g.recommended_action, g.lost_clicks, g.updated_at,
    gs.status AS gs_status,
    gs.notes  AS gs_notes
  FROM cannibalization_group g
  LEFT JOIN group_state gs
    ON gs.project_id = g.project_id AND gs.group_key = g.group_key
  WHERE g.project_id = $1
`

function buildFilterAnds(
  filter: GroupFilter,
  params: unknown[],
): string[] {
  const ands: string[] = []

  function p(val: unknown): string {
    params.push(val)
    return `$${params.length}`
  }

  if (filter.severityBand?.length) {
    const bandParts = filter.severityBand.map(b => `(${BAND_SQL[b]})`).join(' OR ')
    ands.push(`(${bandParts})`)
  }
  if (filter.severityMin !== undefined) {
    ands.push(`g.severity >= ${p(filter.severityMin)}`)
  }
  if (filter.cannType?.length) {
    ands.push(`g.cann_type = ANY(${p(filter.cannType)}::text[])`)
  }
  if (filter.intent?.length) {
    ands.push(`g.query_intent = ANY(${p(filter.intent)}::text[])`)
  }
  if (filter.status?.length) {
    ands.push(`COALESCE(gs.status, 'open') = ANY(${p(filter.status)}::text[])`)
  }
  if (filter.pathPrefix) {
    const esc = filter.pathPrefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    ands.push(
      `EXISTS (SELECT 1 FROM cannibalization_member cm WHERE cm.group_id = g.id AND cm.page LIKE ${p(esc + '%')} ESCAPE '\\')`,
    )
  }
  if (filter.inversionOnly) ands.push('g.inversion = true')
  if (filter.hideBenign) ands.push('g.benign = false')
  if (filter.q) {
    const esc = filter.q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    ands.push(`g.query_norm ILIKE ${p('%' + esc + '%')} ESCAPE '\\'`)
  }

  return ands
}

function buildListSql(
  projectId: string,
  query: GroupListQuery,
): { sqlStr: string; params: unknown[] } {
  const [rawField = 'severity', rawDir = 'desc'] = query.sort.split(':')
  const colExpr = SORT_EXPR[rawField] ?? 'g.severity'
  const dir = rawDir === 'asc' ? 'ASC' : 'DESC'
  const cmp = dir === 'DESC' ? '<' : '>'

  const params: unknown[] = [projectId]
  const ands = buildFilterAnds(query, params)

  function p(val: unknown): string {
    params.push(val)
    return `$${params.length}`
  }

  const cursor = decodeCursor(query.cursor)
  if (cursor !== null) {
    ands.push(`(${colExpr}, g.id) ${cmp} (${p(cursor.sortValue)}, ${p(cursor.id)})`)
  }

  const whereStr = ands.map(c => `AND ${c}`).join('\n    ')
  const sqlStr = `${GROUP_SELECT}${whereStr}
    ORDER BY ${colExpr} ${dir}, g.id ${dir}
    LIMIT ${p(query.limit + 1)}
  `
  return { sqlStr, params }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function listGroups(
  projectId: string,
  query: GroupListQuery,
): Promise<Paginated<CannibalizationGroupDTO>> {
  const sql = serviceClient()
  const { sqlStr, params } = buildListSql(projectId, query)
  const rows = await sql.unsafe<ListRow[]>(sqlStr, params as never[])

  const hasNext = rows.length > query.limit
  const kept = hasNext ? rows.slice(0, query.limit) : rows

  const [rawField = 'severity'] = query.sort.split(':')
  const rowKey = SORT_ROW_KEY[rawField] ?? 'severity'

  let nextCursor: string | null = null
  if (hasNext && kept.length > 0) {
    const last = kept[kept.length - 1]!
    nextCursor = encodeCursor({
      sortValue: last[rowKey] as number,
      id: parseInt(last.id, 10),
    })
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
  const sql = serviceClient()
  const params: unknown[] = [projectId]
  const ands = buildFilterAnds(filter, params)
  const whereStr = ands.map(c => `AND ${c}`).join('\n    ')
  const sqlStr = `${GROUP_SELECT}${whereStr}
    ORDER BY g.severity DESC, g.id DESC
  `
  const rows = await sql.unsafe<ListRow[]>(sqlStr, params as never[])
  return rows.map(r => rowToDTO(r))
}

export async function getGroupProjectKey(
  groupId: number,
): Promise<{ projectId: string; groupKey: string } | null> {
  const sql = serviceClient()
  const rows = await sql<{ project_id: string; group_key: string }[]>`
    SELECT project_id, group_key FROM cannibalization_group WHERE id = ${groupId}
  `
  const row = rows[0]
  return row !== undefined ? { projectId: row.project_id, groupKey: row.group_key } : null
}

export async function getGroupDrill(
  groupId: number,
): Promise<CannibalizationGroupDTO | null> {
  const sql = serviceClient()

  const rows = await sql<DrillRow[]>`
    SELECT
      g.id::text, g.group_key, g.query_norm, g.query_intent, g.search_volume,
      g.cann_type, g.total_clicks, g.total_impressions, g.member_count,
      g.severity, g.winner_page, g.dominant_page, g.inversion, g.benign,
      g.benign_reason, g.recommended_action, g.lost_clicks, g.updated_at,
      gs.status AS gs_status,
      gs.notes  AS gs_notes,
      COALESCE(
        json_agg(
          json_build_object(
            'page',        cm.page,
            'page_type',   cm.page_type,
            'clicks',      cm.clicks,
            'impressions', cm.impressions,
            'position',    cm.position,
            'is_winner',   cm.is_winner
          ) ORDER BY cm.is_winner DESC, cm.impressions DESC
        ) FILTER (WHERE cm.page IS NOT NULL),
        '[]'::json
      ) AS members
    FROM cannibalization_group g
    LEFT JOIN group_state gs
      ON gs.project_id = g.project_id AND gs.group_key = g.group_key
    LEFT JOIN cannibalization_member cm ON cm.group_id = g.id
    WHERE g.id = ${groupId}
    GROUP BY g.id, g.group_key, g.query_norm, g.query_intent, g.search_volume,
             g.cann_type, g.total_clicks, g.total_impressions, g.member_count,
             g.severity, g.winner_page, g.dominant_page, g.inversion, g.benign,
             g.benign_reason, g.recommended_action, g.lost_clicks, g.updated_at,
             gs.status, gs.notes
  `

  const row = rows[0]
  if (row === undefined) return null
  return rowToDTO(row, row.members.map(memberJsonToDTO))
}
