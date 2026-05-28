import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../../server/auth', () => ({
  requireSession: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
}))
vi.mock('../../server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { z } from 'zod'
import { withHandler } from '../../server/http'
import { ContractError } from '../../src/contracts/lib/contract-utils'

function makeRequest(body?: unknown, method = 'POST', url = 'http://localhost/api/test'): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ── success ────────────────────────────────────────────────────────────────────

describe('withHandler — success', () => {
  it('returns 200 with {data, error: null}', async () => {
    const handler = withHandler({}, async () => ({ hello: 'world' }))
    const res = await handler(makeRequest())
    const body = await res.json() as { data: unknown; error: unknown }
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ hello: 'world' })
    expect(body.error).toBeNull()
  })

  it('requestId is present in X-Request-Id header on success', async () => {
    const handler = withHandler({}, async () => null)
    const res = await handler(makeRequest())
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})

// ── ZodError ───────────────────────────────────────────────────────────────────

describe('withHandler — ZodError', () => {
  it('returns 400 with validation_error and fieldErrors in details', async () => {
    const schema = z.object({ name: z.string() })
    const handler = withHandler({ schema }, async () => null)
    const res = await handler(makeRequest({ name: 123 }))
    const body = await res.json() as {
      error: { code: string; requestId: string; details: Record<string, string[]> }
    }
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation_error')
    expect(body.error.details).toBeDefined()
    expect(body.error.details['name']).toBeDefined()
    expect(body.error.requestId).toBeTruthy()
  })
})

// ── ContractError ──────────────────────────────────────────────────────────────

describe('withHandler — ContractError', () => {
  it('not_found → 404', async () => {
    const handler = withHandler({}, async () => {
      throw new ContractError('not_found', 'Item not found')
    })
    const res = await handler(makeRequest())
    const body = await res.json() as { error: { code: string; message: string; requestId: string } }
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('not_found')
    expect(body.error.message).toBe('Item not found')
    expect(body.error.requestId).toBeTruthy()
  })

  it('unauthorized → 401', async () => {
    const handler = withHandler({}, async () => {
      throw new ContractError('unauthorized', 'Not authenticated')
    })
    const res = await handler(makeRequest())
    const body = await res.json() as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('unauthorized')
  })
})

// ── unknown error ──────────────────────────────────────────────────────────────

describe('withHandler — unknown error', () => {
  it('returns 500 with generic message and never exposes the real error', async () => {
    const handler = withHandler({}, async () => {
      throw new Error('secret internal message')
    })
    const res = await handler(makeRequest())
    const body = await res.json() as { error: { code: string; message: string } }
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('internal_error')
    expect(body.error.message).not.toContain('secret')
  })
})

// ── requestId in every response ────────────────────────────────────────────────

describe('withHandler — requestId presence', () => {
  it('requestId is in X-Request-Id header for all response types', async () => {
    const cases: Array<() => Promise<Response>> = [
      () => withHandler({}, async () => ({ ok: true }))(makeRequest()),
      () => withHandler({}, async () => { throw new ContractError('not_found', 'x') })(makeRequest()),
      () => withHandler({}, async () => { throw new Error('boom') })(makeRequest()),
      () => withHandler({ schema: z.object({ n: z.number() }) }, async () => null)(makeRequest({ n: 'bad' })),
    ]
    for (const run of cases) {
      const res = await run()
      expect(res.headers.get('x-request-id')).toBeTruthy()
    }
  })
})
