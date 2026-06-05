import type { ApiError, ApiErrorCode, ApiResult, KeysetCursorPayload, PageCursor } from '../types/api'

// ── Result helpers ─────────────────────────────────────────────────────────────

export function ok<T>(data: T): ApiResult<T> {
  return { data, error: null }
}

export function fail(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ApiResult<never> {
  const error: ApiError = details !== undefined
    ? { code, message, requestId, details }
    : { code, message, requestId }
  return { data: null, error }
}

// ── Cursor codec ───────────────────────────────────────────────────────────────

export function encodeCursor(payload: KeysetCursorPayload): PageCursor {
  return btoa(JSON.stringify(payload))
}

export function decodeCursor(cursor: string | undefined | null): KeysetCursorPayload | null {
  if (!cursor) return null
  try {
    const json = atob(cursor)
    const parsed: unknown = JSON.parse(json)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !('sortValue' in parsed) ||
      !('id' in parsed) ||
      (typeof (parsed as Record<string, unknown>)['sortValue'] !== 'number' &&
       typeof (parsed as Record<string, unknown>)['sortValue'] !== 'string') ||
      (typeof (parsed as Record<string, unknown>)['id'] !== 'number' &&
       typeof (parsed as Record<string, unknown>)['id'] !== 'string')
    ) {
      return null
    }
    return parsed as KeysetCursorPayload
  } catch {
    return null
  }
}

// ── Backoff ────────────────────────────────────────────────────────────────────

export function backoffMs(attempt: number, baseMs = 1000, capMs = 64000): number {
  const raw = baseMs * Math.pow(2, attempt)
  const jitter = 0.8 + Math.random() * 0.4
  return Math.min(capMs, raw * jitter)
}

// ── ContractError ──────────────────────────────────────────────────────────────

export class ContractError extends Error {
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ContractError'
    this.code = code
    if (details !== undefined) {
      this.details = details
    }
  }
}
