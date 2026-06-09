console.log(JSON.stringify({ts: new Date().toISOString(), msg: 'container started'}))
// Cloud Run Job entry point. Reads RUN_ID + PROJECT_ID from env.
// Pipeline: mark running → fetch GSC → load BQ temp table → detect → write results → cleanup.
// On any failure: mark run failed + drop temp table (best-effort).

import { loadEnv } from './env'
import { bqQuery, bqTable } from '../server/db/bq-client'
import { getProject } from '../server/repositories/project.repo'
import { getConnection } from '../server/repositories/connection.repo'
import { updateRunStatus } from '../server/repositories/analysis-run.repo'
import { refreshAccessToken, querySearchAnalytics } from '../server/ingest/gsc-client'
import { normalizeQuery, classifyPage } from '../server/ingest/normalize'
import { decrypt, getEncKey } from '../server/ingest/token-crypto'
import { runDetection } from '../server/engine/detect'
import { log } from '../server/log'

console.log(JSON.stringify({ts: new Date().toISOString(), msg: 'imports loaded'}))

const ANALYSIS_DAYS = 90
const LOAD_CHUNK = 1000

interface TempRow {
  query_norm: string
  page: string
  page_type: string
  date: string
  clicks: number
  impressions: number
  position: number // stored as weighted sum until finalised
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function* iterateDates(start: string, end: string): Generator<string> {
  let cur = start
  while (cur <= end) {
    yield cur
    cur = addDays(cur, 1)
  }
}


async function createTempTable(tableName: string): Promise<void> {
  await bqQuery(`
    CREATE TABLE ${tableName} (
      query_norm   STRING    NOT NULL,
      page         STRING    NOT NULL,
      page_type    STRING    NOT NULL,
      date         DATE      NOT NULL,
      clicks       INT64     NOT NULL,
      impressions  INT64     NOT NULL,
      position     FLOAT64   NOT NULL
    )
    PARTITION BY date
    CLUSTER BY query_norm
    OPTIONS (
      expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    )
  `)
}

async function dropTempTable(tableName: string): Promise<void> {
  await bqQuery(`DROP TABLE IF EXISTS ${tableName}`)
}

async function insertTempRows(tableName: string, rows: readonly TempRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += LOAD_CHUNK) {
    const chunk = rows.slice(i, i + LOAD_CHUNK)
    const params: Record<string, unknown> = {}
    const tuples = chunk.map((r, j) => {
      const p = `r${j}_`
      params[`${p}qn`] = r.query_norm
      params[`${p}pg`] = r.page
      params[`${p}pt`] = r.page_type
      params[`${p}dt`] = r.date
      params[`${p}cl`] = r.clicks
      params[`${p}im`] = r.impressions
      params[`${p}po`] = r.position
      return `(@${p}qn, @${p}pg, @${p}pt, CAST(@${p}dt AS DATE), @${p}cl, @${p}im, @${p}po)`
    })
    await bqQuery(
      `INSERT INTO ${tableName} (query_norm, page, page_type, date, clicks, impressions, position) VALUES ${tuples.join(', ')}`,
      params,
    )
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ts: new Date().toISOString(), msg: 'main started'}))
  const { runId, projectId } = loadEnv()
  console.log(JSON.stringify({ts: new Date().toISOString(), msg: 'env loaded', runId, projectId}))
  const reqId = `job:${runId}`
  const tableName = bqTable(`gsc_metric_temp_${runId}`)
  let tempCreated = false

  try {
    // 1. Mark running
    console.log(JSON.stringify({ts: new Date().toISOString(), msg: 'before first bq call'}))
    await updateRunStatus(runId, 'running', { progressStep: 'starting' })
    log.info(reqId, 'job.started', { projectId })

    // 2. Load project
    const project = await getProject(projectId)
    if (project === null) throw new Error(`Project ${projectId} not found`)

    // 3. Verify GSC connection
    const conn = await getConnection(projectId)
    if (conn === null || conn.status !== 'connected') {
      await updateRunStatus(runId, 'failed', {
        error: `GSC connection not ready (status: ${conn?.status ?? 'missing'})`,
        completed: true,
      })
      log.warn(reqId, 'job.connection_not_ready', { projectId })
      return
    }

    // 4. Resolve access token — decrypt refresh token, exchange with Google
    let plainRefreshToken: string
    try {
      plainRefreshToken = decrypt(conn.refresh_token_enc, getEncKey())
    } catch {
      await updateRunStatus(runId, 'failed', {
        error: 'Token decryption failed — connection may be revoked',
        completed: true,
      })
      log.warn(reqId, 'job.token_decrypt_failed', { projectId })
      return
    }
    const accessToken = await refreshAccessToken(plainRefreshToken)

    // 5. Create temp BQ table (auto-expires after 24h if job crashes)
    await createTempTable(tableName)
    tempCreated = true
    log.info(reqId, 'job.temp_table_created', { projectId })

    // 6. Fetch GSC data day by day and load into temp table
    const endDate = utcToday()
    const startDate = addDays(endDate, -(ANALYSIS_DAYS - 1))
    const siteUrl = project.gscProperty

    let dayIndex = 0
    let rowsFetched = 0

    for (const dateStr of iterateDates(startDate, endDate)) {
      dayIndex++
      await updateRunStatus(runId, 'running', {
        progressStep: `fetching day ${dayIndex}/${ANALYSIS_DAYS}`,
      })

      const gscRows = await querySearchAnalytics({
        accessToken,
        siteUrl,
        startDate: dateStr,
        endDate: dateStr,
        dimensions: ['query', 'page'],
      })

      if (gscRows.length === 0) continue

      // Pre-aggregate by (query_norm, page): impression-weighted position.
      // Normalization can collapse distinct raw queries to the same query_norm;
      // accumulate here before writing to avoid BQ-level duplicate rows per day.
      const byKey = new Map<string, TempRow>()
      for (const r of gscRows) {
        const queryNorm = normalizeQuery(r.keys[0] ?? '')
        const page = r.keys[1] ?? ''
        const key = `${queryNorm}\0${page}`
        const existing = byKey.get(key)
        if (existing === undefined) {
          byKey.set(key, {
            query_norm: queryNorm,
            page,
            page_type: classifyPage(page),
            date: dateStr,
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position * r.impressions, // weighted sum
          })
        } else {
          existing.clicks += r.clicks
          existing.impressions += r.impressions
          existing.position += r.position * r.impressions // accumulate weighted sum
        }
      }

      const rows: TempRow[] = Array.from(byKey.values()).map(r => ({
        ...r,
        // Convert weighted sum → impression-weighted average for storage
        position: r.impressions > 0 ? r.position / r.impressions : 0,
      }))

      await insertTempRows(tableName, rows)
      rowsFetched += rows.length
      log.info(reqId, 'job.day_loaded', { projectId, meta: { date: dateStr, rows: rows.length } })
    }

    log.info(reqId, 'job.fetch_complete', { projectId, meta: { rowsFetched } })

    // 7. Run detection (SQL aggregation + TS scoring + BQ writes)
    await updateRunStatus(runId, 'running', { progressStep: 'running detection' })
    const { groupsFound } = await runDetection(projectId, runId, project.config ?? {})

    // 8. Drop temp table
    await dropTempTable(tableName)
    tempCreated = false

    // 9. Mark completed
    await updateRunStatus(runId, 'completed', {
      completed: true,
      groupsFound,
      rowsFetched,
    })
    log.info(reqId, 'job.completed', { projectId, meta: { groupsFound, rowsFetched } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(reqId, 'job.failed', { projectId, meta: { error: message } })

    try {
      await updateRunStatus(runId, 'failed', { error: message, completed: true })
    } catch (updateErr) {
      log.error(reqId, 'job.status_update_failed', { meta: { error: String(updateErr) } })
    }

    if (tempCreated) {
      try {
        await dropTempTable(tableName)
      } catch {
        // BQ auto-expires after 24h via OPTIONS(expiration_timestamp)
      }
    }

    process.exit(1)
  }
}

main()
