import 'server-only'
import { serviceClient } from '../db/client'
import { runDetection } from '../engine/detect'
import { log } from '../log'

const DETECT_WINDOW_DAYS = 90

export interface TickSummary {
  processed: number
  failed: number
  errors: Array<{ projectId: string; error: string }>
}

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

// TODO(wave-oauth): GSC token refresh and ingestion not yet implemented
export async function syncProject(
  _projectId: string,
): Promise<{ datesSynced: number; skipped: string }> {
  return { datesSynced: 0, skipped: 'gsc not connected' }
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
