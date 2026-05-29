import 'server-only'
import { serviceClient } from '../db/client'
import type { ProjectDTO } from '../../src/contracts/types/entities'
import type { PropertyType, ProjectStatus, GscStatus, RunStatus } from '../../src/contracts/types/domain'
import type { CreateProject, UpdateProject } from '../../src/contracts/schemas/requests'

interface ProjectListRow {
  id: string
  name: string
  gsc_property: string
  property_type: string
  timezone: string
  status: string
  created_at: Date
  updated_at: Date
  conn_status: string | null
  last_synced_date: string | null
  run_id: string | null
  run_status: string | null
  run_groups_found: number | null
  run_started_at: Date | null
  run_finished_at: Date | null
}

function rowToDTO(row: ProjectListRow): ProjectDTO {
  const dto: ProjectDTO = {
    id: row.id,
    name: row.name,
    gscProperty: row.gsc_property,
    propertyType: row.property_type as PropertyType,
    timezone: row.timezone,
    status: row.status as ProjectStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }

  if (row.conn_status !== null) {
    dto.connection = {
      status: row.conn_status as GscStatus,
      lastSyncedDate: row.last_synced_date,
    }
  }

  if (row.run_id !== null && row.run_started_at !== null && row.run_status !== null) {
    dto.lastRun = {
      id: parseInt(row.run_id, 10),
      status: row.run_status as RunStatus,
      groupsFound: row.run_groups_found,
      startedAt: row.run_started_at.toISOString(),
      finishedAt: row.run_finished_at?.toISOString() ?? null,
    }
  } else {
    dto.lastRun = null
  }

  return dto
}

const PROJECT_SELECT = `
  SELECT
    p.id, p.name, p.gsc_property, p.property_type, p.timezone, p.status,
    p.created_at, p.updated_at,
    gc.status          AS conn_status,
    gc.last_synced_date,
    dr.id              AS run_id,
    dr.status          AS run_status,
    dr.groups_found    AS run_groups_found,
    dr.started_at      AS run_started_at,
    dr.finished_at     AS run_finished_at
  FROM project p
  LEFT JOIN gsc_connection gc ON gc.project_id = p.id
  LEFT JOIN LATERAL (
    SELECT id, status, groups_found, started_at, finished_at
    FROM detection_run
    WHERE project_id = p.id
    ORDER BY started_at DESC
    LIMIT 1
  ) dr ON true
`

export async function listProjects(): Promise<ProjectDTO[]> {
  const sql = serviceClient()
  const rows = await sql.unsafe<ProjectListRow[]>(`${PROJECT_SELECT} ORDER BY p.created_at ASC`)
  return rows.map(rowToDTO)
}

export async function getProject(id: string): Promise<ProjectDTO | null> {
  const sql = serviceClient()
  const rows = await sql.unsafe<ProjectListRow[]>(
    `${PROJECT_SELECT} WHERE p.id = $1`,
    [id],
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}

export async function createProject(data: CreateProject): Promise<ProjectDTO> {
  const sql = serviceClient()
  const rows = await sql.unsafe<ProjectListRow[]>(
    `
    WITH ins AS (
      INSERT INTO project (name, gsc_property, property_type, timezone)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    )
    SELECT
      ins.id, ins.name, ins.gsc_property, ins.property_type, ins.timezone, ins.status,
      ins.created_at, ins.updated_at,
      NULL::text   AS conn_status,
      NULL::date   AS last_synced_date,
      NULL::text   AS run_id,
      NULL::text   AS run_status,
      NULL::int    AS run_groups_found,
      NULL::timestamptz AS run_started_at,
      NULL::timestamptz AS run_finished_at
    FROM ins
    `,
    [data.name, data.gscProperty, data.propertyType, data.timezone ?? 'UTC'],
  )
  if (rows[0] === undefined) throw new Error('createProject: insert returned no row')
  return rowToDTO(rows[0])
}

export async function deleteProject(id: string): Promise<boolean> {
  const sql = serviceClient()
  const rows = await sql`DELETE FROM project WHERE id = ${id} RETURNING id`
  return rows.length > 0
}

export async function updateProject(
  id: string,
  data: UpdateProject,
): Promise<ProjectDTO | null> {
  const sql = serviceClient()

  const setParts: string[] = []
  const params: unknown[] = [id]

  function p(val: unknown): string {
    params.push(val)
    return `$${params.length}`
  }

  if (data.name !== undefined) setParts.push(`name = ${p(data.name)}`)
  if (data.timezone !== undefined) setParts.push(`timezone = ${p(data.timezone)}`)
  if (data.status !== undefined) setParts.push(`status = ${p(data.status)}`)
  if (data.config !== undefined) setParts.push(`config = ${p(JSON.stringify(data.config))}::jsonb`)
  setParts.push('updated_at = now()')

  const rows = await sql.unsafe<ProjectListRow[]>(
    `
    WITH upd AS (
      UPDATE project
      SET ${setParts.join(', ')}
      WHERE id = $1
      RETURNING *
    )
    SELECT
      upd.id, upd.name, upd.gsc_property, upd.property_type, upd.timezone, upd.status,
      upd.created_at, upd.updated_at,
      gc.status          AS conn_status,
      gc.last_synced_date,
      dr.id              AS run_id,
      dr.status          AS run_status,
      dr.groups_found    AS run_groups_found,
      dr.started_at      AS run_started_at,
      dr.finished_at     AS run_finished_at
    FROM upd
    LEFT JOIN gsc_connection gc ON gc.project_id = upd.id
    LEFT JOIN LATERAL (
      SELECT id, status, groups_found, started_at, finished_at
      FROM detection_run
      WHERE project_id = upd.id
      ORDER BY started_at DESC
      LIMIT 1
    ) dr ON true
    `,
    params as never[],
  )

  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}
