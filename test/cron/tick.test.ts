import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../../server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../server/auth', () => ({
  requireSession: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
}))
vi.mock('../../server/repositories/project.repo', () => ({
  getProject:     vi.fn().mockResolvedValue(null),
  listProjects:   vi.fn().mockResolvedValue([]),
  createProject:  vi.fn(),
  updateProject:  vi.fn(),
  deleteProject:  vi.fn(),
}))

const m = vi.hoisted(() => ({
  sql: vi.fn(),
  runDetection: vi.fn(),
}))

vi.mock('../../server/db/client', () => ({
  serviceClient: vi.fn(() => m.sql),
}))
vi.mock('../../server/engine/detect', () => ({
  runDetection: m.runDetection,
}))

import { runTick, syncProject } from '../../server/cron/tick'
import { POST } from '../../app/api/cron/tick/route'

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/tick', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Cron route: CRON_SECRET verification ──────────────────────────────────────

describe('POST /api/cron/tick — CRON_SECRET', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })

  it('returns 401 when secret is wrong', async () => {
    const res = await POST(makeRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with summary when secret is correct and no projects exist', async () => {
    m.sql.mockResolvedValueOnce([]) // SELECT active projects → empty
    const res = await POST(makeRequest('Bearer bbbbbbbbbbbbbbbb'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { processed: number; failed: number } }
    expect(body.data.processed).toBe(0)
    expect(body.data.failed).toBe(0)
  })

  it('X-Request-Id header is present on every response', async () => {
    const res = await POST(makeRequest())
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})

// ── syncProject ───────────────────────────────────────────────────────────────

describe('syncProject', () => {
  it('is a no-op stub: always returns datesSynced 0 and skipped reason', async () => {
    const result = await syncProject('any-project-id')
    expect(result.datesSynced).toBe(0)
    expect(result.skipped).toBe('gsc not connected')
  })
})

// ── runTick ───────────────────────────────────────────────────────────────────

describe('runTick', () => {
  it('returns empty summary when no active projects', async () => {
    m.sql.mockResolvedValueOnce([])
    const result = await runTick('req-0')
    expect(result).toEqual({ processed: 0, failed: 0, errors: [] })
  })

  it('processes a project: sync skips (no connection), detect runs', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    m.runDetection.mockResolvedValueOnce({ runId: 'r1', groupsFound: 2 })

    const result = await runTick('req-1')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
    expect(m.runDetection).toHaveBeenCalledWith('p1', expect.any(String), expect.any(String))
  })

  it('counts a project as failed when runDetection throws', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    m.runDetection.mockRejectedValueOnce(new Error('detect boom'))

    const result = await runTick('req-2')
    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.projectId).toBe('p1')
    expect(result.errors[0]?.error).toContain('detect boom')
  })

  it('continues processing remaining projects after one fails', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
    m.runDetection
      .mockRejectedValueOnce(new Error('p1 failed'))
      .mockResolvedValueOnce({ runId: 'r2', groupsFound: 0 })

    const result = await runTick('req-3')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('passes a 90-day window to runDetection', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    m.runDetection.mockResolvedValueOnce({ runId: 'r1', groupsFound: 0 })

    await runTick('req-4')

    const [, windowStart, windowEnd] = m.runDetection.mock.calls[0] as [string, string, string]
    const startMs = new Date(windowStart).getTime()
    const endMs = new Date(windowEnd).getTime()
    const diffDays = Math.round((endMs - startMs) / 86_400_000) + 1
    expect(diffDays).toBe(90)
  })
})
