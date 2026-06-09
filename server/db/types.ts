// Raw DB row types — snake_case, as returned by @google-cloud/bigquery.
// Mapping to camelCase DTOs happens in repositories only.

export interface ProjectRow {
  id: string
  name: string
  gsc_property: string
  property_type: string
  timezone: string
  status: string
  created_at: unknown
  updated_at: unknown
}

// BQ gsc_connection columns: project_id, status, access_token_enc, refresh_token_enc,
// access_token_expires_at (STRING), scopes (STRING), google_sub (NULLABLE STRING),
// google_account_email (NULLABLE STRING), connected_at, updated_at.
export interface GscConnectionRow {
  project_id: string
  google_sub: string | null
  google_account_email: string | null
  refresh_token_enc: string
  access_token: string | null  // plaintext not stored in BQ; null in BQ path
  access_token_expires_at: string | null
  scopes: string | null
  last_synced_date: string | null // not in BQ gsc_connection; null in BQ path
  status: string
  connected_at: unknown
  revoked_at: unknown          // not in BQ; null in BQ path
  updated_at: unknown
}

// BQ analysis_run (replaces Postgres detection_run)
export interface AnalysisRunRow {
  run_id: string
  project_id: string
  status: string               // queued | running | completed | failed
  progress_step: string | null
  started_at: unknown
  completed_at: unknown
  error: string | null
  rows_fetched: string | null  // BQ INT64 returned as string
  groups_found: string | null  // BQ INT64 returned as string
}

export interface CannibalizationGroupRow {
  project_id: string
  group_key: string
  run_id: string
  query_norm: string
  severity: string             // BQ string band: 'low' | 'medium' | 'high' | 'critical'
  cann_type: string
  winner_page: string | null
  should_win_page: string | null // BQ column; maps to dominantPage in DTO
  inversion: boolean
  benign: boolean
  recommended_action: string
  total_clicks: string         // BQ INT64 returned as string
  total_impressions: string    // BQ INT64 returned as string
  detected_at: unknown         // maps to updatedAt in DTO
}

export interface CannibalizationMemberRow {
  project_id: string
  group_key: string
  run_id: string
  page: string
  page_type: string
  clicks: string               // BQ INT64 returned as string
  impressions: string          // BQ INT64 returned as string
  weighted_position: number    // BQ FLOAT64 (maps to position in DTO)
  is_winner: boolean
}

export interface GroupStateRow {
  project_id: string
  group_key: string
  status: string               // mapped from BQ column 'state'
  notes: string | null         // mapped from BQ column 'note'
  updated_at: unknown
}
