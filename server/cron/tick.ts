import 'server-only'
import { serviceClient } from '../db/client'
import { runDetection } from '../engine/detect'
import { log } from '../log'
import { refreshAccessToken, querySearchAnalytics } from '../ingest/gsc-client'
import { persistDate } from '../ingest/persist'
import { decrypt, getEncKey } from '../ingest/token-crypto'
import {
  getConnection,
  markRevoked,
  updateAccessToken,
  updateLastSyncedDate,
} from '../repositories/connection.repo'
import { getProject } from '../repositories/project.repo'
import { ContractError } from '../../src/contracts/lib/contract-utils'

const DETECT_WINDOW_DAYS = 90
const INITIAL_SYNC_DAYS = 90
// Google access tokens are guaranteed ~1 hour; use as TTL when gsc-client doesn't expose expires_in
const ACCESS_TOKEN_TTL_MS = 3600 * 1000

function utcYesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function* iterateDates(startDate: string, endDate: string): Generator<string> {
  let current = startDate
  while (current <= endDate) {
    yield current
    current = addDays(current, 1)
  }
}

export interface TickSummary {
  processed: number
  failed: number
  errors: Array<{ projectId: string; error: string }>
}

export async function syncProject(
  projectId: string,
): Promise<{ datesSynced: number; skipped: string | null }> {
  const sql = serviceClient()

  // ── 1. Advisory lock ────────────────────────────────────────────────────────
  const [lockRow] = await sql.unsafe<Array<{ pg_try_advisory_lock: boolean }>>(
    'SELECT pg_try_advisory_lock(hashtext($1))',
    [projectId],
  )
  if (!lockRow?.pg_try_advisory_lock) {
    return { datesSynced: 0, skipped: 'lock_held' }
  }

  try {
    // ── 2. Read connection ───────────────────────────────────────────────────
    const conn = await getConnection(projectId)
    if (conn === null || conn.status !== 'connected') {
      return { datesSynced: 0, skipped: 'not_connected' }
    }

    // ── 3. Resolve access token ──────────────────────────────────────────────
    let accessToken: string
    const now = Date.now()
    const expiresAt = conn.access_token_expires_at?.getTime() ?? 0
    const isValid = conn.access_token !== null && expiresAt > now + 60_000

    if (isValid && conn.access_token !== null) {
      accessToken = conn.access_token
    } else {
      let plainRefreshToken: string
      try {
        plainRefreshToken = decrypt(conn.refresh_token_enc, getEncKey())
      } catch {
        // Decryption failure means key mismatch — treat as revoked
        await markRevoked(projectId)
        log.warn('cron', 'gsc.token_revoked', { projectId })
        return { datesSynced: 0, skipped: 'revoked' }
      }

      try {
        accessToken = await refreshAccessToken(plainRefreshToken)
      } catch (err) {
        if (err instanceof ContractError && err.code === 'gsc_auth_error') {
          await markRevoked(projectId)
          log.warn('cron', 'gsc.token_revoked', { projectId })
          return { datesSynced: 0, skipped: 'revoked' }
        }
        throw err
      }

      await updateAccessToken(projectId, accessToken, new Date(now + ACCESS_TOKEN_TTL_MS))
    }

    // ── 4. Determine date range ──────────────────────────────────────────────
    const project = await getProject(projectId)
    if (project === null) return { datesSynced: 0, skipped: 'not_connected' }

    const endDate = utcYesterday()
    const startDate = conn.last_synced_date !== null
      ? addDays(conn.last_synced_date, 1)
      : addDays(endDate, -(INITIAL_SYNC_DAYS - 1))

    if (startDate > endDate) {
      return { datesSynced: 0, skipped: 'up_to_date' }
    }

    // ── 5. Sync each date ────────────────────────────────────────────────────
    let datesSynced = 0

    for (const dateStr of iterateDates(startDate, endDate)) {
      const gscRows = await querySearchAnalytics({
        accessToken,
        siteUrl:    project.gscProperty,
        startDate:  dateStr,
        endDate:    dateStr,
        dimensions: ['query', 'page'],
      })

      const rawRows = gscRows.map(r => ({
        query:       r.keys[0] ?? '',
        page:        r.keys[1] ?? '',
        clicks:      r.clicks,
        impressions: r.impressions,
        position:    r.position,
      }))

      await persistDate(projectId, dateStr, rawRows)
      await updateLastSyncedDate(projectId, dateStr)
      datesSynced++
    }

    return { datesSynced, skipped: null }
  } finally {
    await sql.unsafe('SELECT pg_advisory_unlock(hashtext($1))', [projectId])
  }
}

export async function runTick(requestId: string): Promise<TickSummary> {
  const sql = serviceClient()

  const projects = await sql<{ id: string }[]>`
    SELECT id FROM project WHERE status = 'active'
  `

  const summary: TickSummary = { processed: 0, failed: 0, errors: [] }

  for (const project of projects) {
    try {
      await syncProject(project.id)

      const yest = utcYesterday()
      const windowStart = addDays(yest, -(DETECT_WINDOW_DAYS - 1))
      await runDetection(project.id, windowStart, yest)

      summary.processed++
      log.info(requestId, 'tick.project_done', { projectId: project.id })
    } catch (err) {
      summary.failed++
      summary.errors.push({ projectId: project.id, error: String(err) })
      log.error(requestId, 'tick.project_error', {
        projectId: project.id,
        meta: { error: String(err) },
      })
    }
  }

  return summary
}
