import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

const fetchMock = vi.fn()

import { refreshAccessToken, querySearchAnalytics } from '../../server/ingest/gsc-client'
import { ContractError } from '../../src/contracts/lib/contract-utils'

function mockFetch(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

const BASE = {
  accessToken: 'access-token',
  siteUrl:     'https://example.com/',
  startDate:   '2024-01-01',
  endDate:     '2024-01-31',
  dimensions:  ['query', 'page'] as string[],
}

function makeRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    keys:        [`query-${offset + i}`, `https://example.com/p${offset + i}`],
    clicks:      offset + i,
    impressions: (offset + i) * 10,
    ctr:         0.05,
    position:    5,
  }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ── refreshAccessToken ─────────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('returns the access token from Google response', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({ access_token: 'tok-ok', expires_in: 3600 }))
    const token = await refreshAccessToken('rt-fresh-1')
    expect(token).toBe('tok-ok')
  })

  it('caches the token and avoids a second fetch', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({ access_token: 'tok-cached', expires_in: 3600 }))
    await refreshAccessToken('rt-cache-test')
    const token2 = await refreshAccessToken('rt-cache-test')
    expect(token2).toBe('tok-cached')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws gsc_auth_error on 401', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({}, 401))
    await expect(refreshAccessToken('rt-401')).rejects.toMatchObject({
      code: 'gsc_auth_error',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws gsc_auth_error on 403', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({}, 403))
    await expect(refreshAccessToken('rt-403')).rejects.toMatchObject({
      code: 'gsc_auth_error',
    })
  })
})

// ── querySearchAnalytics — dataState: 'final' ──────────────────────────────────

describe('querySearchAnalytics — dataState', () => {
  it('passes dataState: "final" in every request body', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({ rows: [] }))

    await querySearchAnalytics({ ...BASE, rowLimit: 2 })

    const call = fetchMock.mock.calls[0]!
    const sentBody = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
    expect(sentBody['dataState']).toBe('final')
  })
})

// ── querySearchAnalytics — pagination ─────────────────────────────────────────

describe('querySearchAnalytics — pagination', () => {
  it('stops fetching when a page returns fewer rows than rowLimit', async () => {
    const ROW_LIMIT = 3
    fetchMock
      .mockResolvedValueOnce(mockFetch({ rows: makeRows(ROW_LIMIT) }))
      .mockResolvedValueOnce(mockFetch({ rows: makeRows(1, ROW_LIMIT) }))

    const result = await querySearchAnalytics({ ...BASE, rowLimit: ROW_LIMIT })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(ROW_LIMIT + 1)
  })

  it('concatenates rows from multiple pages in order', async () => {
    const ROW_LIMIT = 2
    const page1 = makeRows(ROW_LIMIT, 0)
    const page2 = makeRows(ROW_LIMIT, ROW_LIMIT)
    const page3 = makeRows(1, ROW_LIMIT * 2)

    fetchMock
      .mockResolvedValueOnce(mockFetch({ rows: page1 }))
      .mockResolvedValueOnce(mockFetch({ rows: page2 }))
      .mockResolvedValueOnce(mockFetch({ rows: page3 }))

    const result = await querySearchAnalytics({ ...BASE, rowLimit: ROW_LIMIT })

    expect(result).toHaveLength(ROW_LIMIT * 2 + 1)
    expect(result[0]).toEqual(page1[0])
    expect(result[ROW_LIMIT]).toEqual(page2[0])
    expect(result[ROW_LIMIT * 2]).toEqual(page3[0])
  })

  it('advances startRow by the page size on each subsequent request', async () => {
    const ROW_LIMIT = 2
    fetchMock
      .mockResolvedValueOnce(mockFetch({ rows: makeRows(ROW_LIMIT) }))
      .mockResolvedValueOnce(mockFetch({ rows: [] }))

    await querySearchAnalytics({ ...BASE, rowLimit: ROW_LIMIT })

    const secondCall = fetchMock.mock.calls[1]!
    const body = JSON.parse((secondCall[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body['startRow']).toBe(ROW_LIMIT)
  })

  it('returns empty array when first page has no rows', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({ rows: [] }))
    const result = await querySearchAnalytics({ ...BASE, rowLimit: 5 })
    expect(result).toEqual([])
  })
})

// ── querySearchAnalytics — retry ──────────────────────────────────────────────

describe('querySearchAnalytics — retry', () => {
  it('retries on 429 and returns success on next attempt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(mockFetch({}, 429))
      .mockResolvedValueOnce(mockFetch({ rows: [] }))

    const promise = querySearchAnalytics({ ...BASE, rowLimit: 2 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries on 500 and returns success on next attempt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(mockFetch({}, 500))
      .mockResolvedValueOnce(mockFetch({ rows: makeRows(1) }))

    const promise = querySearchAnalytics({ ...BASE, rowLimit: 2 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws rate_limited after exhausting all attempts on repeated 429', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(mockFetch({}, 429))

    const promise = querySearchAnalytics({ ...BASE, rowLimit: 2 })
    const caught = promise.catch((e: unknown) => e)
    await vi.runAllTimersAsync()

    const err = await caught
    expect(err).toMatchObject({ code: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('throws unavailable after exhausting all attempts on repeated 503', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(mockFetch({}, 503))

    const promise = querySearchAnalytics({ ...BASE, rowLimit: 2 })
    const caught = promise.catch((e: unknown) => e)
    await vi.runAllTimersAsync()

    const err = await caught
    expect(err).toMatchObject({ code: 'unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})

// ── querySearchAnalytics — auth errors ────────────────────────────────────────

describe('querySearchAnalytics — auth errors', () => {
  it('throws gsc_auth_error on 401 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({}, 401))

    await expect(querySearchAnalytics({ ...BASE, rowLimit: 2 })).rejects.toMatchObject({
      code: 'gsc_auth_error',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws gsc_auth_error on 403 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({}, 403))

    await expect(querySearchAnalytics({ ...BASE, rowLimit: 2 })).rejects.toMatchObject({
      code: 'gsc_auth_error',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws gsc_auth_error via ContractError instance', async () => {
    fetchMock.mockResolvedValueOnce(mockFetch({}, 401))

    const err = await querySearchAnalytics({ ...BASE, rowLimit: 2 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractError)
  })
})
