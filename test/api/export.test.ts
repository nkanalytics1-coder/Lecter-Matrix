import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/server/auth', () => ({
  requireSession: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
}))
vi.mock('@/server/repositories/group.repo', () => ({
  exportGroups: vi.fn(),
}))

import { GET } from '../../app/api/projects/[id]/export/route'
import { exportGroups } from '@/server/repositories/group.repo'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'

const FIXTURE: CannibalizationGroupDTO = {
  id: 'gk-test',
  groupKey: 'gk-test',
  queryNorm: 'test query',
  queryIntent: 'informational',
  searchVolume: null,
  cannType: 'blog_vs_blog',
  totalClicks: 100,
  totalImpressions: 1000,
  memberCount: 2,
  severity: 65.5,
  severityBand: 'high',
  winnerPage: 'https://example.com/blog/a',
  dominantPage: 'https://example.com/blog/b',
  inversion: false,
  benign: false,
  benignReason: null,
  recommendedAction: 'differentiate_onpage',
  lostClicks: 30,
  state: { status: 'open', notes: null },
  updatedAt: '2026-05-28T12:00:00.000Z',
}

function makeRequest(projectId = 'proj-1', params = ''): Request {
  return new Request(`http://localhost/api/projects/${projectId}/export${params ? `?${params}` : ''}`)
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/projects/[id]/export', () => {
  it('returns 401 when not authenticated', async () => {
    const { requireSession } = await import('@/server/auth')
    vi.mocked(requireSession).mockRejectedValueOnce(new Error('unauthorized'))

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })

  it('returns 400 for invalid filter params', async () => {
    const res = await GET(
      makeRequest('proj-1', 'severityBand=invalid_band'),
      { params: Promise.resolve({ id: 'proj-1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('streams CSV with header and one data row', async () => {
    vi.mocked(exportGroups).mockResolvedValueOnce([FIXTURE])

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    const text = await res.text()
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('groupKey')
    expect(lines[1]).toContain('gk-test')
    expect(lines[1]).toContain('65.5')
  })

  it('passes filter params to exportGroups', async () => {
    vi.mocked(exportGroups).mockResolvedValueOnce([])

    await GET(
      makeRequest('proj-1', 'inversionOnly=true&severityBand=critical'),
      { params: Promise.resolve({ id: 'proj-1' }) },
    )

    expect(exportGroups).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      inversionOnly: true,
      severityBand: ['critical'],
    }))
  })

  it('returns empty CSV (header only) when no groups match', async () => {
    vi.mocked(exportGroups).mockResolvedValueOnce([])

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    const text = await res.text()
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('groupKey')
  })

  it('escapes CSV fields containing commas', async () => {
    const withComma: CannibalizationGroupDTO = {
      ...FIXTURE,
      queryNorm: 'query, with comma',
    }
    vi.mocked(exportGroups).mockResolvedValueOnce([withComma])

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    const text = await res.text()
    expect(text).toContain('"query, with comma"')
  })
})
