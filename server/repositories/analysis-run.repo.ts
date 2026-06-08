import 'server-only'
import { randomUUID } from 'crypto'
import { bqQuery, bqDml, bqTable } from '../db/bq-client'
import { bqTimestampToISO } from '../db/bq-helpers'
import type { AnalysisRunDTO, AnalysisStatus } from '../../src/contracts/types/api'

// Raw analysis_run row as returned by @google-cloud/bigquery (snake_case;
// INT64 columns arrive as decimal strings). Mapped to AnalysisRunDTO here.
interface AnalysisRunQueryRow {
  run_id:        string
  project_id:    string
  status:        string
  progress_step: string | null
  started_at:    unknown
  completed_at:  unknown
  error:         string | null
  rows_fetched:  string | null // BQ INT64 as string
  groups_found:  string | null // BQ INT64 as string
}

const SELECT_COLS =
  'run_id, project_id, status, progress_step, started_at, completed_at, error, rows_fetched, groups_found'

function rowToDTO(row: AnalysisRunQueryRow): AnalysisRunDTO {
  return {
    runId:        row.run_id,
    status:       row.status as AnalysisStatus,
    progressStep: row.progress_step,
    startedAt:    bqTimestampToISO(row.started_at) as string,
    completedAt:  bqTimestampToISO(row.completed_at),
    error:        row.error,
    groupsFound:  row.groups_found !== null ? Number(row.groups_found) : null,
    rowsFetched:  row.rows_fetched !== null ? Number(row.rows_fetched) : null,
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

// Generates a fresh UUID run_id and inserts a queued row (started_at = now).
// id generation lives in the repo (mirrors project.repo.createProject) so the
// route stays a thin handler. DML INSERT is immediately queryable in BQ.
export async function createRun(projectId: string): Promise<AnalysisRunDTO> {
  const runId = randomUUID()
  await bqDml(
    `
    INSERT INTO ${bqTable('analysis_run')} (run_id, project_id, status, started_at)
    VALUES (@run_id, @project_id, 'queued', CURRENT_TIMESTAMP())
    `,
    { run_id: runId, project_id: projectId },
  )
  const run = await getRun(runId)
  if (run === null) throw new Error('createRun: insert returned no row')
  return run
}

export interface RunStatusFields {
  progressStep?: string | null
  error?:        string | null
  groupsFound?:  number | null
  rowsFetched?:  number | null
  // When true, sets completed_at = CURRENT_TIMESTAMP() (terminal status).
  completed?:    boolean
}

// Patches status plus any provided fields. Null-valued fields emit a SQL NULL
// literal (BQ rejects untyped NULL params); non-null values bind as params.
export async function updateRunStatus(
  runId: string,
  status: AnalysisStatus,
  fields: RunStatusFields = {},
): Promise<void> {
  const setParts: string[] = ['status = @status']
  const params: Record<string, unknown> = { run_id: runId, status }

  const assign = (col: string, key: string, value: string | number | null): void => {
    if (value === null) {
      setParts.push(`${col} = NULL`)
    } else {
      setParts.push(`${col} = @${key}`)
      params[key] = value
    }
  }

  if (fields.progressStep !== undefined) assign('progress_step', 'progress_step', fields.progressStep)
  if (fields.error !== undefined) assign('error', 'error', fields.error)
  if (fields.groupsFound !== undefined) assign('groups_found', 'groups_found', fields.groupsFound)
  if (fields.rowsFetched !== undefined) assign('rows_fetched', 'rows_fetched', fields.rowsFetched)
  if (fields.completed === true) setParts.push('completed_at = CURRENT_TIMESTAMP()')

  await bqDml(
    `UPDATE ${bqTable('analysis_run')} SET ${setParts.join(', ')} WHERE run_id = @run_id`,
    params,
  )
}

// ── Reads ────────────────────────────────────────────────────────────────────

// Most recent in-flight run (queued|running) for the project — the concurrency
// guard for the POST /analysis route. null when nothing is in flight.
export async function getActiveRun(projectId: string): Promise<AnalysisRunDTO | null> {
  const rows = await bqQuery<AnalysisRunQueryRow>(
    `
    SELECT ${SELECT_COLS}
    FROM ${bqTable('analysis_run')}
    WHERE project_id = @project_id AND status IN ('queued', 'running')
    ORDER BY started_at DESC
    LIMIT 1
    `,
    { project_id: projectId },
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}

export async function getRun(runId: string): Promise<AnalysisRunDTO | null> {
  const rows = await bqQuery<AnalysisRunQueryRow>(
    `SELECT ${SELECT_COLS} FROM ${bqTable('analysis_run')} WHERE run_id = @run_id LIMIT 1`,
    { run_id: runId },
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}

// Latest run for the project regardless of status — backs the status endpoint.
export async function getLatestRun(projectId: string): Promise<AnalysisRunDTO | null> {
  const rows = await bqQuery<AnalysisRunQueryRow>(
    `
    SELECT ${SELECT_COLS}
    FROM ${bqTable('analysis_run')}
    WHERE project_id = @project_id
    ORDER BY started_at DESC
    LIMIT 1
    `,
    { project_id: projectId },
  )
  return rows[0] !== undefined ? rowToDTO(rows[0]) : null
}
