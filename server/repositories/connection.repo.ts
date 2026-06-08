import 'server-only'
import { bqQuery, bqDml, bqTable } from '../db/bq-client'
import type { GscConnectionRow } from '../db/types'

// BQ gsc_connection schema:
// project_id, status, access_token_enc, refresh_token_enc, access_token_expires_at (STRING),
// scopes, connected_at (TIMESTAMP), updated_at (TIMESTAMP)
//
// GscConnectionRow keeps legacy field names for tick.ts (Fase 9 drop) compatibility.
// Fields absent from BQ are returned as null/''.

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getConnection(projectId: string): Promise<GscConnectionRow | null> {
  const rows = await bqQuery<{
    project_id: string
    status: string
    refresh_token_enc: string
    access_token_expires_at: string | null
    connected_at: unknown
    updated_at: unknown
  }>(
    `
    SELECT
      project_id,
      status,
      COALESCE(refresh_token_enc, '') AS refresh_token_enc,
      access_token_expires_at,
      connected_at,
      updated_at
    FROM ${bqTable('gsc_connection')}
    WHERE project_id = @project_id
    `,
    { project_id: projectId },
  )

  const row = rows[0]
  if (row === undefined) return null

  return {
    project_id: row.project_id,
    google_sub: '',              // not in BQ schema
    google_account_email: '',   // not in BQ schema
    refresh_token_enc: row.refresh_token_enc,
    access_token: null,          // not in BQ (only encrypted token stored)
    access_token_expires_at: row.access_token_expires_at,
    last_synced_date: null,      // not in BQ gsc_connection
    status: row.status,
    connected_at: row.connected_at,
    revoked_at: null,            // not in BQ
    updated_at: row.updated_at,
  }
}

// ── Pending upsert (auth-url / connect routes) ────────────────────────────────

export async function setPending(projectId: string): Promise<void> {
  // BQ: MERGE to upsert (no ON CONFLICT support)
  await bqDml(
    `
    MERGE ${bqTable('gsc_connection')} T
    USING (SELECT @project_id AS project_id) S
    ON T.project_id = S.project_id
    WHEN MATCHED THEN
      UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (project_id, status, refresh_token_enc, connected_at, updated_at)
      VALUES (@project_id, 'pending', '', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `,
    { project_id: projectId },
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
  // BQ: DELETE + INSERT (no ON CONFLICT).
  // Each DML is individually atomic; if INSERT fails after DELETE, row is lost.
  await bqDml(
    `DELETE FROM ${bqTable('gsc_connection')} WHERE project_id = @project_id`,
    { project_id: data.projectId },
  )
  await bqDml(
    `
    INSERT INTO ${bqTable('gsc_connection')} (
      project_id, status, refresh_token_enc,
      access_token_expires_at, connected_at, updated_at
    ) VALUES (
      @project_id, 'connected', @refresh_token_enc,
      @access_token_expires_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
    )
    `,
    {
      project_id: data.projectId,
      refresh_token_enc: data.refreshTokenEnc,
      access_token_expires_at: data.accessTokenExpiresAt.toISOString(),
    },
  )
}

// ── Status transitions ─────────────────────────────────────────────────────────

export async function markRevoked(projectId: string): Promise<void> {
  await bqDml(
    `
    UPDATE ${bqTable('gsc_connection')}
    SET status       = 'revoked',
        updated_at   = CURRENT_TIMESTAMP()
    WHERE project_id = @project_id
    `,
    { project_id: projectId },
  )
}

export async function disconnectProject(projectId: string): Promise<void> {
  await bqDml(
    `
    UPDATE ${bqTable('gsc_connection')}
    SET status            = 'disconnected',
        refresh_token_enc = '',
        updated_at        = CURRENT_TIMESTAMP()
    WHERE project_id = @project_id
    `,
    { project_id: projectId },
  )
}

// ── Token cache writes ────────────────────────────────────────────────────────
// access_token_enc is updated here with the new encrypted token.
// The plaintext token is NOT written to BQ; only the expiry timestamp is stored.

export async function updateAccessToken(
  projectId: string,
  _token: string,
  expiresAt: Date,
): Promise<void> {
  await bqDml(
    `
    UPDATE ${bqTable('gsc_connection')}
    SET access_token_expires_at = @expires_at,
        updated_at              = CURRENT_TIMESTAMP()
    WHERE project_id = @project_id
    `,
    { project_id: projectId, expires_at: expiresAt.toISOString() },
  )
}

// last_synced_date does not exist in the BQ gsc_connection schema.
// This function is a no-op stub retained for tick.ts (Fase 9 drop) compatibility.
export async function updateLastSyncedDate(_projectId: string, _date: string): Promise<void> {
  // no-op in BQ path: sync state is tracked via analysis_run instead
}
