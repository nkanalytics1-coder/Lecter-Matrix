import 'server-only'
import { timingSafeEqual, createHmac } from 'node:crypto'
import { log } from '@/server/log'
import { encrypt, getEncKey } from '@/server/ingest/token-crypto'
import { upsertConnection } from '@/server/repositories/connection.repo'
import { getProject } from '@/server/repositories/project.repo'
import { randomUUID } from 'node:crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const NONCE_COOKIE = 'gsc_oauth_nonce'
const NONCE_COOKIE_CLEAR = `${NONCE_COOKIE}=; Max-Age=0; Path=/api/auth/gsc/callback; HttpOnly; SameSite=Lax`

// ── Helpers ────────────────────────────────────────────────────────────────────

function redirect(base: string, path: string, clearNonce: boolean): Response {
  const appBase = process.env['NEXT_PUBLIC_URL'] ?? 'http://localhost:3000'
  const headers = new Headers({ Location: `${appBase}${path}` })
  if (clearNonce) headers.append('Set-Cookie', NONCE_COOKIE_CLEAR)
  return new Response(null, { status: 302, headers })
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=')
      if (idx < 0) return [c.trim(), '']
      return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()]
    }),
  )
}

interface StatePayload {
  projectId: string
  nonce: string
  flow?: 'onboarding' | 'settings'
}

// Where to send the browser after the OAuth handshake. The onboarding wizard
// resumes at its property-picker step; settings reconnect returns to settings.
function destForFlow(payload: StatePayload | null): string {
  const projectId = payload?.projectId ?? ''
  if (!projectId) return '/app'
  if (payload?.flow === 'onboarding') return `/onboarding?projectId=${projectId}`
  return `/p/${projectId}/settings`
}

function verifyState(
  stateFull: string,
  key: Buffer,
): StatePayload | null {
  const dotIdx = stateFull.lastIndexOf('.')
  if (dotIdx < 0) return null
  const payload = stateFull.slice(0, dotIdx)
  const sig = stateFull.slice(dotIdx + 1)

  const expectedSig = createHmac('sha256', key).update(payload).digest('hex')
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as StatePayload
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  id_token: string
  error?: string
}

function parseIdToken(idToken: string): { sub: string; email: string } | null {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3 || parts[1] === undefined) return null
    const raw = Buffer.from(parts[1], 'base64url').toString('utf-8')
    const payload = JSON.parse(raw) as { sub?: string; email?: string }
    if (!payload.sub || !payload.email) return null
    return { sub: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID()
  const url = new URL(req.url)
  const errorParam = url.searchParams.get('error')
  const stateFull = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code')

  const key = getEncKey()
  const statePayload = verifyState(stateFull, key)

  // Redirect destination (settings vs onboarding wizard) is encoded in the state.
  const dest = destForFlow(statePayload)
  const sep = dest.includes('?') ? '&' : '?'

  // ── User denied / error from Google ─────────────────────────────────────────
  if (errorParam !== null) {
    return redirect('', `${dest}${sep}gsc=error&reason=denied`, true)
  }

  // ── CSRF state validation ────────────────────────────────────────────────────
  if (statePayload === null) {
    return redirect('', `${dest}${sep}gsc=error&reason=state_mismatch`, true)
  }

  const cookies = parseCookies(req.headers.get('cookie'))
  const cookieNonce = cookies[NONCE_COOKIE]
  if (!cookieNonce || cookieNonce !== statePayload.nonce) {
    return redirect('', `${dest}${sep}gsc=error&reason=state_mismatch`, true)
  }

  if (!code) {
    log.error(requestId, 'gsc.callback.no_code', { projectId: statePayload.projectId })
    return redirect('', `${dest}${sep}gsc=error&reason=auth_failed`, true)
  }

  // ── Verify project exists ────────────────────────────────────────────────────
  const project = await getProject(statePayload.projectId)
  if (project === null) {
    return redirect('', `${dest}${sep}gsc=error&reason=project_not_found`, true)
  }

  // ── Token exchange ───────────────────────────────────────────────────────────
  let tokenRes: TokenResponse
  try {
    const body = new URLSearchParams({
      code,
      client_id:     process.env['GSC_CLIENT_ID'] ?? '',
      client_secret: process.env['GSC_CLIENT_SECRET'] ?? '',
      redirect_uri:  process.env['GSC_REDIRECT_URI'] ?? '',
      grant_type:    'authorization_code',
    })
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    tokenRes = await res.json() as TokenResponse

    if (!res.ok) {
      const reason = tokenRes.error === 'invalid_grant' ? 'code_expired' : 'auth_failed'
      if (res.status >= 500) {
        log.warn(requestId, 'gsc.google_unavailable', { projectId: statePayload.projectId })
        return redirect('', `${dest}${sep}gsc=error&reason=google_unavailable`, true)
      }
      return redirect('', `${dest}${sep}gsc=error&reason=${reason}`, true)
    }
  } catch (err) {
    log.error(requestId, 'gsc.callback.token_exchange_failed', { projectId: statePayload.projectId, meta: String(err) })
    return redirect('', `${dest}${sep}gsc=error&reason=auth_failed`, true)
  }

  // ── Scope verification ───────────────────────────────────────────────────────
  const grantedScopes = tokenRes.scope ?? ''
  if (
    !grantedScopes.includes('webmasters.readonly') ||
    !grantedScopes.includes('openid') ||
    !grantedScopes.includes('email')
  ) {
    log.warn(requestId, 'gsc.insufficient_scope', { projectId: statePayload.projectId })
    return redirect('', `${dest}${sep}gsc=error&reason=insufficient_scope`, true)
  }

  // ── refresh_token presence (§6.6) ───────────────────────────────────────────
  if (!tokenRes.refresh_token) {
    log.warn(requestId, 'gsc.missing_refresh_token', { projectId: statePayload.projectId })
    return redirect('', `${dest}${sep}gsc=error&reason=no_refresh_token`, true)
  }

  // ── id_token decode ──────────────────────────────────────────────────────────
  const identity = parseIdToken(tokenRes.id_token)
  if (identity === null) {
    log.error(requestId, 'gsc.callback.bad_id_token', { projectId: statePayload.projectId })
    return redirect('', `${dest}${sep}gsc=error&reason=auth_failed`, true)
  }

  // ── Persist ──────────────────────────────────────────────────────────────────
  const refreshTokenEnc = encrypt(tokenRes.refresh_token, key)
  const accessTokenExpiresAt = new Date(Date.now() + tokenRes.expires_in * 1000)
  const scopeArray = grantedScopes.split(' ').filter(Boolean)

  await upsertConnection({
    projectId:            statePayload.projectId,
    googleSub:            identity.sub,
    googleAccountEmail:   identity.email,
    refreshTokenEnc,
    accessToken:          tokenRes.access_token,
    accessTokenExpiresAt,
    scopes:               scopeArray,
  })

  log.info(requestId, 'gsc.connected', { projectId: statePayload.projectId })

  return redirect('', `${dest}${sep}gsc=connected`, true)
}
