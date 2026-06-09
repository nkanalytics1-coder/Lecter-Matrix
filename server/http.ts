import 'server-only'
import { ZodError, type ZodSchema } from 'zod'
import { randomUUID } from 'crypto'
import type { User } from '@supabase/supabase-js'
import { API_ERROR_STATUS } from '../src/contracts/types/api'
import { ok, fail, ContractError } from '../src/contracts/lib/contract-utils'
import { requireSession } from './auth'
import { log } from './log'

interface HandlerConfig<P> {
  protected?: boolean
  schema?: ZodSchema<P>
}

interface HandlerCtx<P> {
  requestId: string
  parsed: P
  user: User | null
}

type HandlerFn<P> = (ctx: HandlerCtx<P>) => Promise<unknown>

export function withHandler<P = undefined>(
  config: HandlerConfig<P>,
  fn: HandlerFn<P>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = randomUUID()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    }
    try {
      const user = config.protected === true ? await requireSession() : null
      let parsed: P = undefined as unknown as P
      if (config.schema !== undefined) {
        const raw: unknown = req.method === 'GET'
          ? Object.fromEntries(new URL(req.url).searchParams)
          : await req.json()
        parsed = config.schema.parse(raw)
      }
      const data = await fn({ requestId, parsed, user })
      log.info(requestId, 'request.ok')
      return new Response(JSON.stringify(ok(data)), { status: 200, headers })
    } catch (err) {
      if (err instanceof ZodError) {
        return new Response(
          JSON.stringify(fail('validation_error', 'Validation failed', requestId, err.flatten().fieldErrors)),
          { status: 400, headers },
        )
      }
      if (err instanceof ContractError) {
        return new Response(
          JSON.stringify(fail(err.code, err.message, requestId, err.details)),
          { status: API_ERROR_STATUS[err.code], headers },
        )
      }
      log.error(requestId, 'request.error')
      return new Response(
        JSON.stringify(fail('internal_error', 'An unexpected error occurred', requestId)),
        { status: 500, headers },
      )
    }
  }
}
