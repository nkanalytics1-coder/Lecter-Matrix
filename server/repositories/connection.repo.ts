import 'server-only'
import { serviceClient } from '../db/client'
import type { GscConnectionRow } from '../db/types'

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getConnection(projectId: string): Promise<GscConnectionRow | null> {
  const sql = serviceClient()
  const rows = await sql<GscConnectionRow[]>`
    SELECT * FROM gsc_connection WHERE project_id = ${projectId}
  `
  return rows[0] ?? null
}

// ── Pending upsert (auth-url / connect routes) ────────────────────────────────

export async function setPending(projectId: string): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    INSERT INTO gsc_connection
      (project_id, google_sub, google_account_email, refresh_token_enc, status, connected_at)
    VALUES ($1, '', '', '', 'pending', now())
    ON CONFLICT (project_id) DO UPDATE
      SET status     = 'pending',
          updated_at = now()
    `,
    [projectId],
  )
}

// ── Full upsert after OAuth callback ──────────────────────────────────────────

export interface UpsertConnectionData {
  projectId: string
  googleSub: string
  googleAccountEmail: string
  refreshTokenEnc: string
  accessToken: string
  accessTokenExpiresAt: Date
}

export async function upsertConnection(data: UpsertConnectionData): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    INSERT INTO gsc_connection (
      project_id, google_sub, google_account_email,
      refresh_token_enc, access_token, access_token_expires_at,
      status, connected_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'connected', now(), now())
    ON CONFLICT (project_id) DO UPDATE SET
      google_sub              = EXCLUDED.google_sub,
      google_account_email    = EXCLUDED.google_account_email,
      refresh_token_enc       = EXCLUDED.refresh_token_enc,
      access_token            = EXCLUDED.access_token,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      status                  = 'connected',
      connected_at            = now(),
      revoked_at              = NULL,
      updated_at              = now()
    `,
    [
      data.projectId,
      data.googleSub,
      data.googleAccountEmail,
      data.refreshTokenEnc,
      data.accessToken,
      data.accessTokenExpiresAt,
    ],
  )
}

// ── Status transitions ─────────────────────────────────────────────────────────

export async function markRevoked(projectId: string): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    UPDATE gsc_connection
    SET status       = 'revoked',
        revoked_at   = now(),
        access_token = NULL,
        updated_at   = now()
    WHERE project_id = $1
    `,
    [projectId],
  )
}

export async function disconnectProject(projectId: string): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    UPDATE gsc_connection
    SET status                  = 'disconnected',
        access_token            = NULL,
        access_token_expires_at = NULL,
        refresh_token_enc       = '',
        revoked_at              = now(),
        updated_at              = now()
    WHERE project_id = $1
    `,
    [projectId],
  )
}

// ── Token cache writes (from syncProject) ─────────────────────────────────────

export async function updateAccessToken(
  projectId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    UPDATE gsc_connection
    SET access_token            = $2,
        access_token_expires_at = $3,
        updated_at              = now()
    WHERE project_id = $1
    `,
    [projectId, token, expiresAt],
  )
}

export async function updateLastSyncedDate(projectId: string, date: string): Promise<void> {
  const sql = serviceClient()
  await sql.unsafe(
    `
    UPDATE gsc_connection
    SET last_synced_date = $2,
        updated_at       = now()
    WHERE project_id = $1
    `,
    [projectId, date],
  )
}
