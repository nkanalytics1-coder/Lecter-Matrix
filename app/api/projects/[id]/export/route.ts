import 'server-only'
import { randomUUID } from 'crypto'
import { GroupFilterSchema } from '@/src/contracts/schemas/requests'
import { exportGroups } from '@/server/repositories/group.repo'
import { requireSession } from '@/server/auth'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'

export const runtime = 'nodejs'

const CSV_HEADER = 'id,groupKey,queryNorm,queryIntent,cannType,severity,severityBand,totalClicks,totalImpressions,lostClicks,winnerPage,dominantPage,inversion,benign,benignReason,recommendedAction,stateStatus,updatedAt'

function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toRow(g: CannibalizationGroupDTO): string {
  return [
    g.id, g.groupKey, g.queryNorm, g.queryIntent, g.cannType,
    g.severity, g.severityBand, g.totalClicks, g.totalImpressions, g.lostClicks,
    g.winnerPage, g.dominantPage, g.inversion, g.benign, g.benignReason,
    g.recommendedAction, g.state?.status ?? '', g.updatedAt,
  ].map(esc).join(',')
}

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: projectId } = await ctx.params
  try { await requireSession() } catch {
    return new Response(
      JSON.stringify({ data: null, error: { code: 'unauthorized', message: 'Not authenticated', requestId: randomUUID() } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const filterResult = GroupFilterSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!filterResult.success) {
    return new Response(
      JSON.stringify({ data: null, error: { code: 'validation_error', message: 'Validation failed', requestId: randomUUID() } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(CSV_HEADER + '\n'))
        const groups = await exportGroups(projectId, filterResult.data)
        for (const g of groups) controller.enqueue(encoder.encode(toRow(g) + '\n'))
        controller.close()
      } catch { controller.error(new Error('export failed')) }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="groups-${projectId}.csv"`,
    },
  })
}
