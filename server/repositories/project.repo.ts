import 'server-only'
import { bqQuery, bqDml, bqTable } from '../db/bq-client'
import { bqTimestampToISO } from '../db/bq-helpers'
import type { ProjectDTO } from '../../src/contracts/types/entities'
import type { PropertyType, ProjectStatus, GscStatus, RunStatus } from '../../src/contracts/types/domain'
import type { CreateProject, UpdateProject } from '../../src/contracts/schemas/requests'

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

interface ProjectListRow {
  id: string
  name: string
  gsc_property: string
  property_type: string
  timezone: string
  status: string
  created_at: unknown
  updated_at: unknown
  conn_status: string | null
  run_id: string | null
  run_status: string | null
  run_groups_found: string | null // BQ INT64 as string
  run_started_at: unknown
  run_completed_at: unknown
}

function rowToDTO(row: ProjectListRow): ProjectDTO {
  const dto: ProjectDTO = {
    id: row.id,
    name: row.name,
    gscProperty: row.gsc_property,
    propertyType: row.property_type as PropertyType,
    timezone: row.timezone,
    status: row.status as ProjectStatus,
    createdAt: bqTimestampToISO(row.created_at) as string,
    updatedAt: bqTimestampToISO(row.updated_at) as string,
  }

  if (row.conn_status !== null) {
    dto.connection = {
      status: row.conn_status as GscStatus,
      lastSyncedDate: null, // last_synced_date not in BQ gsc_connection
    }
  }

  if (row.run_id !== null && row.run_started_at !== null && row.run_status !== null) {
    dto.lastRun = {
      id: runIdToInt(row.run_id),
      status: mapRunStatus(row.run_status),
      groupsFound: row.run_groups_found !== null ? Number(row.run_groups_found) : null,
      startedAt: bqTimestampToISO(row.run_started_at) as string,
      finishedAt: bqTimestampToISO(row.run_completed_at),
    }
  } else {
    dto.lastRun = null
  }

  return dto
}

// WITH CTE to get the latest analysis_run per project (replaces Postgres LATERAL JOIN)
function projectSelectSql(whereClause = ''): string {
  return `
    WITH latest_run AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY started_at DESC) AS rn
      FROM ${bqTable('analysis_run')}
    )
    SELECT
      p.id, p.name, p.gsc_property, p.property_type, p.timezone, p.status,
      p.created_at, p.updated_at,
      gc.status          AS conn_status,
      lr.run_id,
      lr.status          AS run_status,
      lr.groups_found    AS run_groups_found,
      lr.started_at      AS run_started_at,
      lr.completed_at    AS run_completed_at
    FROM ${bqTable('project')} p
    LEFT JOIN ${bqTable('gsc_connection')} gc ON gc.project_id = p.id
    LEFT JOIN latest_run lr ON lr.project_id = p.id AND lr.rn = 1
    ${whereClause}
  `
}

export async function listProjects(): Promise<ProjectDTO[]> {
  const rows = await bqQuery<ProjectListRow>(
    `${projectSelectSql()} ORDER BY p.created_at ASC`,
  )
  return rows.map(rowToDTO)
}

export async function getProject(id: string): Promise<ProjectDTO | null> {
  const rows = await bqQuery<ProjectListRow>(
    projectSelectSql('WHERE p.id = @id'),
    { id },
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}

export async function createProject(data: CreateProject): Promise<ProjectDTO> {
  const id = crypto.randomUUID()
  const timezone = data.timezone ?? 'UTC'

  await bqDml(
    `
    INSERT INTO ${bqTable('project')} (id, name, gsc_property, property_type, timezone, status, created_at, updated_at)
    VALUES (@id, @name, @gsc_property, @property_type, @timezone, 'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `,
    { id, name: data.name, gsc_property: data.gscProperty, property_type: data.propertyType, timezone },
  )

  const rows = await bqQuery<ProjectListRow>(
    projectSelectSql('WHERE p.id = @id'),
    { id },
  )
  if (rows[0] === undefined) throw new Error('createProject: insert returned no row')
  return rowToDTO(rows[0])
}

export async function deleteProject(id: string): Promise<boolean> {
  const check = await bqQuery<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM ${bqTable('project')} WHERE id = @id`,
    { id },
  )
  if (Number(check[0]?.cnt ?? 0) === 0) return false

  await bqDml(`DELETE FROM ${bqTable('project')} WHERE id = @id`, { id })
  return true
}

export async function updateProject(
  id: string,
  data: UpdateProject,
): Promise<ProjectDTO | null> {
  const setParts: string[] = ['updated_at = CURRENT_TIMESTAMP()']
  const params: Record<string, unknown> = { id }

  if (data.name !== undefined) {
    setParts.push('name = @name')
    params['name'] = data.name
  }
  if (data.timezone !== undefined) {
    setParts.push('timezone = @timezone')
    params['timezone'] = data.timezone
  }
  if (data.status !== undefined) {
    setParts.push('status = @status')
    params['status'] = data.status
  }

  await bqDml(
    `UPDATE ${bqTable('project')} SET ${setParts.join(', ')} WHERE id = @id`,
    params,
  )

  const rows = await bqQuery<ProjectListRow>(
    projectSelectSql('WHERE p.id = @id'),
    { id },
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}
