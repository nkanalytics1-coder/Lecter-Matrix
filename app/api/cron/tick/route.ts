import { randomUUID } from 'node:crypto'
import { ok, fail } from '../../../../src/contracts/lib/contract-utils'
import { runTick } from '../../../../server/cron/tick'
import { log } from '../../../../server/log'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
  }

  const secret = process.env['CRON_SECRET']
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(
      JSON.stringify(fail('unauthorized', 'Invalid cron secret', requestId)),
      { status: 401, headers },
    )
  }

  try {
    const summary = await runTick(requestId)
    log.info(requestId, 'tick.complete', { meta: summary })
    return new Response(JSON.stringify(ok(summary)), { status: 200, headers })
  } catch (err) {
    log.error(requestId, 'tick.fatal', { meta: { error: String(err) } })
    return new Response(
      JSON.stringify(fail('internal_error', 'Tick failed', requestId)),
      { status: 500, headers },
    )
  }
}
