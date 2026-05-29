import 'server-only'
import { serviceClient } from '../db/client'
import type { OverviewDTO } from '../../src/contracts/types/entities'
import type { GroupStateRow } from '../db/types'
import type { SeverityBand, GscStatus, RunStatus } from '../../src/contracts/types/domain'
import type { UpdateGroupState } from '../../src/contracts/schemas/requests'

// ── Group state ────────────────────────────────────────────────────────────

export async function upsertGroupState(
  projectId: string,
  groupKey: string,
  data: UpdateGroupState,
): Promise<GroupStateRow> {
  const sql = serviceClient()

  const setParts: string[] = ['updated_at = now()']
  const params: unknown[] = [projectId, groupKey]

  function p(val: unknown): string {
    params.push(val)
    return `$${params.length}`
  }

  if (data.status !== undefined) setParts.push(`status = ${p(data.status)}`)
  if (data.notes !== undefined) setParts.push(`notes = ${p(data.notes)}`)

  const rows = await sql.unsafe<GroupStateRow[]>(
    `
    INSERT INTO group_state (project_id, group_key, status, notes)
    VALUES ($1, $2, COALESCE($3, 'open'), $4)
    ON CONFLICT (project_id, group_key) DO UPDATE
      SET ${setParts.join(', ')}
    RETURNING *
    `,
    [
      projectId,
      groupKey,
      (data.status as string | undefined) ?? null,
      (data.notes as string | null | undefined) ?? null,
    ],
  )

  if (rows[0] === undefined) throw new Error('upsertGroupState: no row returned')
  return rows[0]
}

export async function getGroupState(
  projectId: string,
  groupKey: string,
): Promise<GroupStateRow | null> {
  const sql = serviceClient()
  const rows = await sql<GroupStateRow[]>`
    SELECT * FROM group_state
    WHERE project_id = ${projectId} AND group_key = ${groupKey}
  `
  return rows[0] ?? null
}

// ── Overview ───────────────────────────────────────────────────────────────

interface BandCountRow {
  band: string
  groups: number
  impressions: number
  lost_clicks: number
}

interface RunRow {
  id: string
  status: string
  groups_found: number | null
  started_at: Date
  finished_at: Date | null
}

interface ConnRow {
  status: string
  last_synced_date: string | null
}

const EMPTY_BAND: OverviewDTO['bandCounts'][SeverityBand] = {
  groups: 0,
  impressions: 0,
  lostClicks: 0,
}

export async function getOverview(projectId: string): Promise<OverviewDTO> {
  const sql = serviceClient()

  const [bandRows, runRows, connRows] = await Promise.all([
    sql<BandCountRow[]>`
      SELECT
        CASE
          WHEN severity >= 70 THEN 'critical'
          WHEN severity >= 50 THEN 'high'
          WHEN severity >= 30 THEN 'medium'
          ELSE 'low'
        END                        AS band,
        COUNT(*)::int               AS groups,
        SUM(total_impressions)::int AS impressions,
        SUM(lost_clicks)::int       AS lost_clicks
      FROM cannibalization_group
      WHERE project_id = ${projectId}
      GROUP BY band
    `,
    sql<RunRow[]>`
      SELECT id::text, status, groups_found, started_at, finished_at
      FROM detection_run
      WHERE project_id = ${projectId}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    sql<ConnRow[]>`
      SELECT status, last_synced_date::text
      FROM gsc_connection
      WHERE project_id = ${projectId}
    `,
  ])

  const bandCounts: OverviewDTO['bandCounts'] = {
    critical: { ...EMPTY_BAND },
    high:     { ...EMPTY_BAND },
    medium:   { ...EMPTY_BAND },
    low:      { ...EMPTY_BAND },
  }
  for (const r of bandRows) {
    const band = r.band as SeverityBand
    bandCounts[band] = {
      groups:     r.groups,
      impressions: r.impressions,
      lostClicks: r.lost_clicks,
    }
  }

  const run = runRows[0]
  const lastRun = run !== undefined
    ? {
        id: parseInt(run.id, 10),
        status: run.status as RunStatus,
        groupsFound: run.groups_found,
        startedAt: run.started_at.toISOString(),
        finishedAt: run.finished_at?.toISOString() ?? null,
      }
    : null

  const conn = connRows[0]
  const sync: OverviewDTO['sync'] = conn !== undefined
    ? { status: conn.status as GscStatus, lastSyncedDate: conn.last_synced_date }
    : { status: 'error' as GscStatus, lastSyncedDate: null }

  return { bandCounts, lastRun, sync }
}
