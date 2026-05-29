import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../../server/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../server/auth', () => ({
  requireSession: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
}))

const m = vi.hoisted(() => {
  const unsafeFn = vi.fn()
  const sqlFn = Object.assign(vi.fn(), { unsafe: unsafeFn })
  return {
    sql: sqlFn,
    runDetection: vi.fn(),
    getConnection: vi.fn(),
    updateAccessToken: vi.fn(),
    updateLastSyncedDate: vi.fn(),
    markRevoked: vi.fn(),
    refreshAccessToken: vi.fn(),
    querySearchAnalytics: vi.fn(),
    persistDate: vi.fn(),
    getProject: vi.fn(),
    decrypt: vi.fn(),
    getEncKey: vi.fn(),
  }
})

vi.mock('../../server/db/client', () => ({
  serviceClient: vi.fn(() => m.sql),
}))
vi.mock('../../server/engine/detect', () => ({
  runDetection: m.runDetection,
}))
vi.mock('../../server/repositories/connection.repo', () => ({
  getConnection:        m.getConnection,
  updateAccessToken:    m.updateAccessToken,
  updateLastSyncedDate: m.updateLastSyncedDate,
  markRevoked:          m.markRevoked,
}))
vi.mock('../../server/ingest/gsc-client', () => ({
  refreshAccessToken:    m.refreshAccessToken,
  querySearchAnalytics:  m.querySearchAnalytics,
}))
vi.mock('../../server/ingest/persist', () => ({
  persistDate: m.persistDate,
}))
vi.mock('../../server/repositories/project.repo', () => ({
  getProject:    m.getProject,
  listProjects:  vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}))
vi.mock('../../server/ingest/token-crypto', () => ({
  decrypt:    m.decrypt,
  getEncKey:  m.getEncKey,
}))

import { runTick, syncProject } from '../../server/cron/tick'
import { POST } from '../../app/api/cron/tick/route'
import { ContractError } from '../../src/contracts/lib/contract-utils'

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/tick', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

// Shared advisory lock mock: always grants the lock
function mockLock(): void {
  m.sql.unsafe
    .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])  // acquire
    .mockResolvedValueOnce([{}])                               // release
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: sql template tag used for listing projects
  m.sql.mockResolvedValue([])
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

describe('syncProject — lock contention', () => {
  it('returns skipped=lock_held when advisory lock is not granted', async () => {
    m.sql.unsafe = vi.fn().mockResolvedValueOnce([{ pg_try_advisory_lock: false }])
    const result = await syncProject('p1')
    expect(result.datesSynced).toBe(0)
    expect(result.skipped).toBe('lock_held')
  })
})

describe('syncProject — not connected', () => {
  it('returns skipped=not_connected when no connection row exists', async () => {
    mockLock()
    m.getConnection.mockResolvedValueOnce(null)
    const result = await syncProject('p1')
    expect(result.datesSynced).toBe(0)
    expect(result.skipped).toBe('not_connected')
  })

  it('returns skipped=not_connected when status is not connected', async () => {
    mockLock()
    m.getConnection.mockResolvedValueOnce({ status: 'revoked', access_token: null, refresh_token_enc: 'enc', access_token_expires_at: null, last_synced_date: null })
    const result = await syncProject('p1')
    expect(result.datesSynced).toBe(0)
    expect(result.skipped).toBe('not_connected')
  })
})

describe('syncProject — token refresh', () => {
  // Set last_synced_date 2 days ago → only 1 date (yesterday) remains to sync
  function twoDaysAgo(): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 2)
    return d.toISOString().slice(0, 10)
  }

  function connectedConn(overrides: Partial<{
    access_token: string | null
    access_token_expires_at: Date | null
    last_synced_date: string | null
    refresh_token_enc: string
  }> = {}): object {
    return {
      status: 'connected',
      access_token: null,
      access_token_expires_at: null,
      last_synced_date: twoDaysAgo(),
      refresh_token_enc: 'enc-token',
      ...overrides,
    }
  }

  it('uses cached access_token when still valid', async () => {
    mockLock()
    const futureExpiry = new Date(Date.now() + 3600_000)
    m.getConnection.mockResolvedValueOnce(
      connectedConn({ access_token: 'cached-token', access_token_expires_at: futureExpiry }),
    )
    m.getProject.mockResolvedValueOnce({ gscProperty: 'sc-domain:example.com' })
    m.querySearchAnalytics.mockResolvedValueOnce([])
    m.persistDate.mockResolvedValueOnce(undefined)
    m.updateLastSyncedDate.mockResolvedValueOnce(undefined)

    await syncProject('p1')

    expect(m.refreshAccessToken).not.toHaveBeenCalled()
    expect(m.querySearchAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'cached-token' }),
    )
  })

  it('refreshes token when expired and saves new token to DB', async () => {
    mockLock()
    m.getConnection.mockResolvedValueOnce(connectedConn())
    m.getEncKey.mockReturnValue(Buffer.alloc(32))
    m.decrypt.mockReturnValue('plain-refresh-token')
    m.refreshAccessToken.mockResolvedValueOnce('new-access-token')
    m.updateAccessToken.mockResolvedValueOnce(undefined)
    m.getProject.mockResolvedValueOnce({ gscProperty: 'sc-domain:example.com' })
    m.querySearchAnalytics.mockResolvedValueOnce([])
    m.persistDate.mockResolvedValueOnce(undefined)
    m.updateLastSyncedDate.mockResolvedValueOnce(undefined)

    await syncProject('p1')

    expect(m.refreshAccessToken).toHaveBeenCalledWith('plain-refresh-token')
    expect(m.updateAccessToken).toHaveBeenCalledWith('p1', 'new-access-token', expect.any(Date))
  })

  it('marks revoked and returns skipped=revoked on gsc_auth_error', async () => {
    mockLock()
    m.getConnection.mockResolvedValueOnce(connectedConn())
    m.getEncKey.mockReturnValue(Buffer.alloc(32))
    m.decrypt.mockReturnValue('plain-refresh-token')
    m.refreshAccessToken.mockRejectedValueOnce(
      new ContractError('gsc_auth_error', 'Token revoked'),
    )
    m.markRevoked.mockResolvedValueOnce(undefined)

    const result = await syncProject('p1')
    expect(result.skipped).toBe('revoked')
    expect(m.markRevoked).toHaveBeenCalledWith('p1')
  })

  it('propagates non-auth errors from refreshAccessToken', async () => {
    mockLock()
    m.getConnection.mockResolvedValueOnce(connectedConn())
    m.getEncKey.mockReturnValue(Buffer.alloc(32))
    m.decrypt.mockReturnValue('plain-refresh-token')
    m.refreshAccessToken.mockRejectedValueOnce(new Error('network error'))

    await expect(syncProject('p1')).rejects.toThrow('network error')
  })
})

describe('syncProject — date range', () => {
  function setup(): void {
    mockLock()
    m.getConnection.mockResolvedValueOnce({
      status: 'connected',
      access_token: 'tok',
      access_token_expires_at: new Date(Date.now() + 3600_000),
      last_synced_date: null,
      refresh_token_enc: 'enc',
    })
    m.getProject.mockResolvedValueOnce({ gscProperty: 'sc-domain:example.com' })
  }

  it('returns skipped=up_to_date when already synced to yesterday', async () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yestStr = yesterday.toISOString().slice(0, 10)

    mockLock()
    m.getConnection.mockResolvedValueOnce({
      status: 'connected',
      access_token: 'tok',
      access_token_expires_at: new Date(Date.now() + 3600_000),
      last_synced_date: yestStr,
      refresh_token_enc: 'enc',
    })

    const result = await syncProject('p1')
    expect(result.skipped).toBe('up_to_date')
    expect(result.datesSynced).toBe(0)
  })

  it('calls querySearchAnalytics and persistDate for each date', async () => {
    setup()
    // Mock only 1 date to keep test fast: set last_synced_date to 2 days ago → 1 date to sync
    const twoDaysAgo = new Date()
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    const twoDaysAgoStr = twoDaysAgo.toISOString().slice(0, 10)

    m.getConnection.mockReset()
    mockLock()
    m.getConnection.mockResolvedValueOnce({
      status: 'connected',
      access_token: 'tok',
      access_token_expires_at: new Date(Date.now() + 3600_000),
      last_synced_date: twoDaysAgoStr,
      refresh_token_enc: 'enc',
    })
    m.getProject.mockResolvedValueOnce({ gscProperty: 'sc-domain:example.com' })
    m.querySearchAnalytics.mockResolvedValueOnce([
      { keys: ['query1', 'https://example.com/page'], clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
    ])
    m.persistDate.mockResolvedValueOnce(undefined)
    m.updateLastSyncedDate.mockResolvedValueOnce(undefined)

    const result = await syncProject('p1')
    expect(result.datesSynced).toBe(1)
    expect(result.skipped).toBeNull()
    expect(m.persistDate).toHaveBeenCalledTimes(1)
    expect(m.updateLastSyncedDate).toHaveBeenCalledTimes(1)
  })
})

// ── runTick ───────────────────────────────────────────────────────────────────

describe('runTick', () => {
  it('returns empty summary when no active projects', async () => {
    m.sql.mockResolvedValueOnce([])
    const result = await runTick('req-0')
    expect(result).toEqual({ processed: 0, failed: 0, errors: [] })
  })

  it('processes a project: sync runs, detect runs', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    // syncProject: lock + not_connected path
    m.sql.unsafe
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{}])
    m.getConnection.mockResolvedValueOnce(null)
    m.runDetection.mockResolvedValueOnce({ runId: 'r1', groupsFound: 2 })

    const result = await runTick('req-1')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
    expect(m.runDetection).toHaveBeenCalledWith('p1', expect.any(String), expect.any(String))
  })

  it('counts a project as failed when runDetection throws', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    m.sql.unsafe
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{}])
    m.getConnection.mockResolvedValueOnce(null)
    m.runDetection.mockRejectedValueOnce(new Error('detect boom'))

    const result = await runTick('req-2')
    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.projectId).toBe('p1')
    expect(result.errors[0]?.error).toContain('detect boom')
  })

  it('continues processing remaining projects after one fails', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
    // p1: lock acquired + not_connected; p2: lock acquired + not_connected
    m.sql.unsafe
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{}])
    m.getConnection
      .mockResolvedValueOnce(null)  // p1: not connected
      .mockResolvedValueOnce(null)  // p2: not connected
    m.runDetection
      .mockRejectedValueOnce(new Error('p1 failed'))
      .mockResolvedValueOnce({ runId: 'r2', groupsFound: 0 })

    const result = await runTick('req-3')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('passes a 90-day window to runDetection', async () => {
    m.sql.mockResolvedValueOnce([{ id: 'p1' }])
    m.sql.unsafe
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{}])
    m.getConnection.mockResolvedValueOnce(null)
    m.runDetection.mockResolvedValueOnce({ runId: 'r1', groupsFound: 0 })

    await runTick('req-4')

    const [, windowStart, windowEnd] = m.runDetection.mock.calls[0] as [string, string, string]
    const startMs = new Date(windowStart).getTime()
    const endMs = new Date(windowEnd).getTime()
    const diffDays = Math.round((endMs - startMs) / 86_400_000) + 1
    expect(diffDays).toBe(90)
  })
})
