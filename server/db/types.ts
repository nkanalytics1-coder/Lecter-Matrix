// Raw DB row types — snake_case, as returned by the postgres driver.
// Mapping to camelCase DTOs happens in repositories only.
// bigint (int8) columns are returned as string by postgres v3 by default.

export interface ProjectRow {
  id: string
  name: string
  gsc_property: string
  property_type: string
  timezone: string
  config: Record<string, unknown>
  status: string
  created_at: Date
  updated_at: Date
}

export interface GscConnectionRow {
  project_id: string
  google_sub: string
  refresh_token_enc: Buffer
  scopes: string[]
  last_synced_date: string | null
  status: string
  updated_at: Date
}

export interface GscMetricRow {
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

export interface DetectionRunRow {
  id: string
  project_id: string
  window_start: string
  window_end: string
  status: string
  groups_found: number | null
  started_at: Date
  finished_at: Date | null
}

export interface CannibalizationGroupRow {
  id: string
  project_id: string
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
}

export interface CannibalizationMemberRow {
  group_id: string
  page: string
  page_type: string
  clicks: number
  impressions: number
  position: number
  is_winner: boolean
}

export interface GroupStateRow {
  project_id: string
  group_key: string
  status: string
  notes: string | null
  updated_at: Date
}
