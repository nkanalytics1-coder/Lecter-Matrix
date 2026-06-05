-- BigQuery schema — Lecter-Matrix persistent tables
-- GCP project : lecter-matrix-prod
-- Dataset     : gsc_data
-- Location    : EU  (GDPR; GSC data concerns European users)
--
-- Execution:
--   bq mk --location=EU --dataset lecter-matrix-prod:gsc_data
--   bq query --project_id=lecter-matrix-prod --use_legacy_sql=false < bigquery/schema.sql
--
-- Transient table gsc_metric_temp_{run_id} is NOT here: the Cloud Run Job
-- creates and drops it at runtime (see BIGQUERY_DESIGN.md § 3).

-- ---------------------------------------------------------------------------
-- 1. project
-- ---------------------------------------------------------------------------
-- One row per project (≤ 1 000 rows lifetime).
-- Maps to ProjectDTO (src/contracts/types/entities.ts:ProjectDTO).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.project` (
  id            STRING    NOT NULL,  -- ProjectDTO.id
  name          STRING    NOT NULL,  -- ProjectDTO.name
  gsc_property  STRING    NOT NULL,  -- ProjectDTO.gscProperty; GSC property URL (sc-domain: or https://)
  property_type STRING    NOT NULL,  -- PropertyType enum: domain | url_prefix
  timezone      STRING    NOT NULL,  -- IANA timezone string; default 'UTC'
  status        STRING    NOT NULL,  -- ProjectStatus enum: active | paused | archived
  config        JSON,                -- ProjectConfigSchema (src/contracts/schemas/project-config.ts); nullable
  created_at    TIMESTAMP NOT NULL,  -- ProjectDTO.createdAt
  updated_at    TIMESTAMP NOT NULL   -- ProjectDTO.updatedAt
)
CLUSTER BY id
OPTIONS (
  description = 'Project metadata. Small lookup table; no partitioning needed. Maps to ProjectDTO.'
);

-- ---------------------------------------------------------------------------
-- 2. gsc_connection
-- ---------------------------------------------------------------------------
-- One row per project. OAuth tokens are AES-256-encrypted with TOKEN_ENC_KEY
-- before write; BQ never stores plaintext credentials.
-- Maps to ProjectDTO.connection (GscStatus) and GscConnectionRow in repo layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.gsc_connection` (
  project_id               STRING    NOT NULL,  -- FK → project.id
  status                   STRING    NOT NULL,  -- GscStatus: connected | revoked | error
  access_token_enc         STRING,              -- AES-256-encrypted; null when status != connected
  refresh_token_enc        STRING,              -- AES-256-encrypted; null when status != connected
  access_token_expires_at  STRING,              -- ISO 8601 string, nullable (GscConnectionRow.access_token_expires_at)
  scopes                   STRING,              -- space-separated OAuth scopes
  connected_at             TIMESTAMP NOT NULL,
  updated_at               TIMESTAMP NOT NULL
)
CLUSTER BY project_id
OPTIONS (
  description = 'GSC OAuth credentials per project. Tokens AES-256-encrypted before write. Maps to ProjectDTO.connection.'
);

-- ---------------------------------------------------------------------------
-- 3. analysis_run
-- ---------------------------------------------------------------------------
-- One active row per project at a time. A new analysis on the same project
-- issues DELETE WHERE project_id + INSERT (atomic in the Cloud Run Job).
-- Partitioned by started_at so status-polling reads scan only the current
-- partition. No partition_expiration_days: rows are persistent reference data.
-- Maps to ProjectDTO.lastRun (RunStatus).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.analysis_run` (
  run_id         STRING    NOT NULL,  -- UUID without hyphens; ProjectDTO.lastRun.id (string here, int in legacy DTO)
  project_id     STRING    NOT NULL,  -- FK → project.id
  status         STRING    NOT NULL,  -- RunStatus: queued | running | completed | failed
  progress_step  STRING,              -- human-readable step, e.g. "fetching day 23/90"
  started_at     TIMESTAMP NOT NULL,  -- ProjectDTO.lastRun.startedAt
  completed_at   TIMESTAMP,           -- ProjectDTO.lastRun.finishedAt
  error          STRING,              -- non-null only when status = failed
  rows_fetched   INT64,               -- total GSC rows loaded into temp table
  groups_found   INT64                -- ProjectDTO.lastRun.groupsFound
)
PARTITION BY DATE(started_at)
CLUSTER BY project_id
OPTIONS (
  description = 'One row per analysis run per project. DELETE + INSERT on new run. Maps to ProjectDTO.lastRun.'
);

-- ---------------------------------------------------------------------------
-- 4. cannibalization_group
-- ---------------------------------------------------------------------------
-- Fully replaced on each analysis run (DELETE WHERE project_id + INSERT).
-- group_key is a deterministic hash of sorted member pages; stable across runs
-- so group_state triage survives re-analysis.
-- Partitioned by detected_at for efficient date-range scans; clustered by
-- (project_id, group_key) for keyset pagination and drill lookups.
-- Maps to CannibalizationGroupDTO (src/contracts/types/entities.ts).
-- Note: group_key IS the primary key (natural, deterministic). FARM_FINGERPRINT
-- for a synthetic numeric id is not needed — CannibalizationGroupDTO.id maps
-- directly to group_key (DTO id type is string, not number).
-- Note: severity_score is the raw numeric score from scoring.ts (0–100);
-- severityBand (low|medium|high|critical) is derived in the API layer, not stored.
-- CannibalizationGroupDTO.dominantPage maps to should_win_page here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.cannibalization_group` (
  project_id          STRING    NOT NULL,  -- FK → project.id
  group_key           STRING    NOT NULL,  -- deterministic hash(sorted member pages); CannibalizationGroupDTO.id + groupKey
  run_id              STRING    NOT NULL,  -- FK → analysis_run.run_id
  query_norm          STRING    NOT NULL,  -- normalised query; CannibalizationGroupDTO.queryNorm
  query_intent        STRING    NOT NULL,  -- QueryIntent enum; CannibalizationGroupDTO.queryIntent
  search_volume       INT64,               -- estimated monthly search volume; nullable (CannibalizationGroupDTO.searchVolume)
  member_count        INT64     NOT NULL,  -- number of pages in this group; CannibalizationGroupDTO.memberCount
  severity_score      FLOAT64   NOT NULL,  -- raw numeric score 0–100 from scoring.ts; severityBand derived in API layer
  cann_type           STRING    NOT NULL,  -- CannType enum value; CannibalizationGroupDTO.cannType
  winner_page         STRING,              -- CannibalizationGroupDTO.winnerPage
  should_win_page     STRING,              -- CannibalizationGroupDTO.dominantPage (the page that should rank instead)
  inversion           BOOL      NOT NULL,  -- CannibalizationGroupDTO.inversion
  benign              BOOL      NOT NULL,  -- CannibalizationGroupDTO.benign
  benign_reason       STRING,              -- reason code when benign = true; nullable (CannibalizationGroupDTO.benignReason)
  recommended_action  STRING    NOT NULL,  -- RecommendedAction enum; CannibalizationGroupDTO.recommendedAction
  total_clicks        INT64     NOT NULL,  -- CannibalizationGroupDTO.totalClicks
  total_impressions   INT64     NOT NULL,  -- CannibalizationGroupDTO.totalImpressions
  lost_clicks         INT64     NOT NULL,  -- estimated clicks lost to cannibalization; CannibalizationGroupDTO.lostClicks
  detected_at         TIMESTAMP NOT NULL   -- partition column; CannibalizationGroupDTO.updatedAt (run timestamp)
)
PARTITION BY DATE(detected_at)
CLUSTER BY project_id, group_key
OPTIONS (
  description = 'Cannibalization groups. Fully replaced per project on each analysis run. Maps to CannibalizationGroupDTO.'
);

-- ---------------------------------------------------------------------------
-- 5. cannibalization_member
-- ---------------------------------------------------------------------------
-- One row per (group, page) pair. Fully replaced alongside cannibalization_group.
-- No partition: member counts are bounded by group count × avg pages/group
-- (typically < 10 M rows total); clustering on (project_id, group_key) is
-- sufficient for the drill query.
-- Maps to GroupMemberDTO (src/contracts/types/entities.ts).
-- Note: GroupMemberDTO.position = weighted_position (impression-weighted avg).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.cannibalization_member` (
  project_id         STRING    NOT NULL,  -- FK → project.id
  group_key          STRING    NOT NULL,  -- FK → cannibalization_group.group_key
  run_id             STRING    NOT NULL,  -- FK → analysis_run.run_id
  page               STRING    NOT NULL,  -- GroupMemberDTO.page
  page_type          STRING    NOT NULL,  -- PageType enum; GroupMemberDTO.pageType
  clicks             INT64     NOT NULL,  -- GroupMemberDTO.clicks
  impressions        INT64     NOT NULL,  -- GroupMemberDTO.impressions
  weighted_position  FLOAT64   NOT NULL,  -- impression-weighted avg; GroupMemberDTO.position
  is_winner          BOOL      NOT NULL   -- GroupMemberDTO.isWinner
)
CLUSTER BY project_id, group_key
OPTIONS (
  description = 'Members of each cannibalization group. Fully replaced on each analysis run. Maps to GroupMemberDTO.'
);

-- ---------------------------------------------------------------------------
-- 6. group_state
-- ---------------------------------------------------------------------------
-- User triage state. NOT replaced on re-analysis: persists across runs.
-- group_key is deterministic (same algorithm as cannibalization_group.group_key),
-- so a re-run that produces the same logical group retains the user's triage.
-- Orphaned rows (group_key absent from current cannibalization_group for the
-- project) are cleaned up by the Cloud Run Job post-run:
--   DELETE group_state WHERE project_id = @p
--     AND group_key NOT IN (SELECT group_key FROM cannibalization_group WHERE project_id = @p)
-- Maps to CannibalizationGroupDTO.state ({ status: GroupStatus; notes: string | null }).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lecter-matrix-prod.gsc_data.group_state` (
  project_id  STRING    NOT NULL,  -- FK → project.id
  group_key   STRING    NOT NULL,  -- FK → cannibalization_group.group_key (stable cross-run)
  state       STRING    NOT NULL,  -- GroupStatus: open | in_progress | resolved | ignored
  note        STRING,              -- CannibalizationGroupDTO.state.notes
  updated_at  TIMESTAMP NOT NULL
)
CLUSTER BY project_id, group_key
OPTIONS (
  description = 'User triage state per group. Survives re-runs; orphaned keys cleaned up post-run. Maps to CannibalizationGroupDTO.state.'
);
