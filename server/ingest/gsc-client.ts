import { ContractError, backoffMs } from '../../src/contracts/lib/contract-utils'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GSC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3'
const DEFAULT_ROW_LIMIT = 25_000
const MAX_ATTEMPTS = 6

// ── Token cache ────────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  expiresAt:   number
}
const tokenCache = new Map<string, CachedToken>()

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const now = Date.now()
  const hit = tokenCache.get(refreshToken)
  if (hit !== undefined && hit.expiresAt > now + 60_000) return hit.accessToken

  const body = new URLSearchParams({
    client_id:     process.env['GSC_CLIENT_ID'] ?? '',
    client_secret: process.env['GSC_CLIENT_SECRET'] ?? '',
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (res.status === 401 || res.status === 403) {
    throw new ContractError('gsc_auth_error', `Token refresh rejected — status ${res.status}`)
  }
  if (!res.ok) {
    throw new ContractError('internal_error', `Token refresh failed — status ${res.status}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  tokenCache.set(refreshToken, { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 })
  return json.access_token
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GscRow {
  keys:        string[]
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

export interface QuerySearchAnalyticsParams {
  accessToken: string
  siteUrl:     string
  startDate:   string
  endDate:     string
  dimensions:  string[]
  rowLimit?:   number
}

// ── Paginated query ────────────────────────────────────────────────────────────

export async function querySearchAnalytics(
  params: QuerySearchAnalyticsParams,
): Promise<GscRow[]> {
  const { accessToken, siteUrl, startDate, endDate, dimensions } = params
  const rowLimit = params.rowLimit ?? DEFAULT_ROW_LIMIT
  const url = `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

  const all: GscRow[] = []
  let startRow = 0

  for (;;) {
    const data = await fetchWithRetry<{ rows?: GscRow[] }>(url, accessToken, {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      dataState: 'final',
    })
    const rows = data.rows ?? []
    all.push(...rows)
    if (rows.length < rowLimit) break
    startRow += rows.length
  }

  return all
}

// ── Retry wrapper ──────────────────────────────────────────────────────────────

async function fetchWithRetry<T>(
  url:   string,
  token: string,
  body:  unknown,
): Promise<T> {
  let attempt = 0

  for (;;) {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.status === 401 || res.status === 403) {
      throw new ContractError('gsc_auth_error', `GSC auth rejected — status ${res.status}`)
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS - 1) {
        const code = res.status === 429 ? 'rate_limited' : 'unavailable'
        throw new ContractError(code, `GSC request failed after ${MAX_ATTEMPTS} attempts — status ${res.status}`)
      }
      await sleep(backoffMs(attempt))
      attempt++
      continue
    }

    if (!res.ok) {
      throw new ContractError('internal_error', `GSC request failed — status ${res.status}`)
    }

    return res.json() as Promise<T>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
