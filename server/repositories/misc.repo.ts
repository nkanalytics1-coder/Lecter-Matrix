import 'server-only'
import { bqQuery, bqDml, bqTable } from '../db/bq-client'
import { bqTimestampToISO } from '../db/bq-helpers'
import type { OverviewDTO } from '../../src/contracts/types/entities'
import type { GroupStateRow } from '../db/types'
import type { SeverityBand, GscStatus, RunStatus } from '../../src/contracts/types/domain'
import type { UpdateGroupState } from '../../src/contracts/schemas/requests'

// BQ RunStatus mapping: 'queued'|'completed' → RunStatus contract values
function mapRunStatus(s: string): RunStatus {
  if (s === 'completed') return 'succeeded'
  if (s === 'queued' || s === 'running') return 'running'
  return 'failed'
}

// Derive a stable pseudo-integer from a UUID run_id for DTO compatibility
function runIdToInt(runId: string): number {
  return parseInt(runId.replace(/-/g, '').slice(0, 8), 16)
}

// ── Group state ────────────────────────────────────────────────────────────────
// BQ group_state columns: project_id, group_key, state, note, updated_at
// GroupStateRow uses 'status' / 'notes' (legacy names); mapped here.

export async function upsertGroupState(
  projectId: string,
  groupKey: string,
  data: UpdateGroupState,
): Promise<GroupStateRow> {
  const newState = (data.status as string | undefined) ?? 'open'
  const newNote = (data.notes as string | null | undefined) ?? null

  await bqDml(
    `
    MERGE ${bqTable('group_state')} T
    USING (SELECT @project_id AS project_id, @group_key AS group_key) S
    ON T.project_id = S.project_id AND T.group_key = S.group_key
    WHEN MATCHED THEN
      UPDATE SET
        state      = @state,
        note       = @note,
        updated_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (project_id, group_key, state, note, updated_at)
      VALUES (@project_id, @group_key, @state, @note, CURRENT_TIMESTAMP())
    `,
    { project_id: projectId, group_key: groupKey, state: newState, note: newNote },
  )

  const row = await getGroupState(projectId, groupKey)
  if (row === null) throw new Error('upsertGroupState: MERGE produced no row')
  return row
}

export async function getGroupState(
  projectId: string,
  groupKey: string,
): Promise<GroupStateRow | null> {
  const rows = await bqQuery<{ project_id: string; group_key: string; state: string; note: string | null; updated_at: unknown }>(
    `
    SELECT project_id, group_key, state, note, updated_at
    FROM ${bqTable('group_state')}
    WHERE project_id = @project_id AND group_key = @group_key
    `,
    { project_id: projectId, group_key: groupKey },
  )

  const row = rows[0]
  if (row === undefined) return null

  return {
    project_id: row.project_id,
    group_key: row.group_key,
    status: row.state,   // BQ 'state' → GroupStateRow 'status'
    notes: row.note,     // BQ 'note'  → GroupStateRow 'notes'
    updated_at: row.updated_at,
  }
}

// ── Overview ───────────────────────────────────────────────────────────────────

interface BandCountRow {
  band: string
  groups: string       // BQ INT64 as string
  impressions: string  // BQ INT64 as string
  lost_clicks: string  // BQ INT64 as string
}

interface RunRow {
  run_id: string
  status: string
  groups_found: string | null
  started_at: unknown
  completed_at: unknown
}

interface ConnRow {
  status: string
}

const EMPTY_BAND: OverviewDTO['bandCounts'][SeverityBand] = {
  groups: 0,
  impressions: 0,
  lostClicks: 0,
}

export async function getOverview(projectId: string): Promise<OverviewDTO> {
  const [bandRows, runRows, connRows] = await Promise.all([
    bqQuery<BandCountRow>(
      `
      SELECT
        CASE
          WHEN severity_score >= 70 THEN 'critical'
          WHEN severity_score >= 50 THEN 'high'
          WHEN severity_score >= 30 THEN 'medium'
          ELSE 'low'
        END                            AS band,
        CAST(COUNT(*) AS STRING)       AS \`groups\`,
        CAST(SUM(CAST(total_impressions AS INT64)) AS STRING) AS impressions,
        CAST(SUM(CAST(lost_clicks AS INT64)) AS STRING)       AS lost_clicks
      FROM ${bqTable('cannibalization_group')}
      WHERE project_id = @project_id
      GROUP BY band
      `,
      { project_id: projectId },
    ),
    bqQuery<RunRow>(
      `
      SELECT run_id, status, groups_found, started_at, completed_at
      FROM ${bqTable('analysis_run')}
      WHERE project_id = @project_id
      ORDER BY started_at DESC
      LIMIT 1
      `,
      { project_id: projectId },
    ),
    bqQuery<ConnRow>(
      `
      SELECT status
      FROM ${bqTable('gsc_connection')}
      WHERE project_id = @project_id
      `,
      { project_id: projectId },
    ),
  ])

  const bandCounts: OverviewDTO['bandCounts'] = {
    critical: { ...EMPTY_BAND },
    high:     { ...EMPTY_BAND },
    medium:   { ...EMPTY_BAND },
    low:      { ...EMPTY_BAND },
  }
  for (const r of bandRows) {
    const band = r.band as SeverityBand
    if (band in bandCounts) {
      bandCounts[band] = {
        groups:     Number(r.groups),
        impressions: Number(r.impressions),
        lostClicks: Number(r.lost_clicks),
      }
    }
  }

  const run = runRows[0]
  const lastRun = run !== undefined
    ? {
        id: runIdToInt(run.run_id),
        status: mapRunStatus(run.status),
        groupsFound: run.groups_found !== null ? Number(run.groups_found) : null,
        startedAt: bqTimestampToISO(run.started_at) as string,
        finishedAt: bqTimestampToISO(run.completed_at),
      }
    : null

  const conn = connRows[0]
  const sync: OverviewDTO['sync'] = conn !== undefined
    ? { status: conn.status as GscStatus, lastSyncedDate: null }
    : { status: 'disconnected' as GscStatus, lastSyncedDate: null }

  return { bandCounts, lastRun, sync }
}
