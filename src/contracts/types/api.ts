export const ApiErrorCode = [
  'validation_error',
  'unauthorized',
  'not_found',
  'conflict',
  'rate_limited',
  'gsc_auth_error',
  'internal_error',
  'unavailable',
] as const
export type ApiErrorCode = (typeof ApiErrorCode)[number]

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized:     401,
  not_found:        404,
  conflict:         409,
  rate_limited:     429,
  gsc_auth_error:   422,
  internal_error:   500,
  unavailable:      503,
}

export interface ApiError {
  code:      ApiErrorCode
  message:   string
  requestId: string
  details?:  unknown
}

export type ApiResult<T> =
  | { data: T;    error: null }
  | { data: null; error: ApiError }

export interface Paginated<T> {
  items:      T[]
  nextCursor: string | null
  pageSize:   number
}

// ── Analysis run ────────────────────────────────────────────────────────────────
// Raw BQ analysis_run.status values (queued|running|completed|failed). Distinct
// from domain RunStatus (running|succeeded|failed), which is the legacy 3-state
// projection used by ProjectDTO.lastRun. The analysis status endpoint surfaces the
// raw BQ status so the polling client can show queued/running/completed/failed.
export const AnalysisStatus = ['queued', 'running', 'completed', 'failed'] as const
export type AnalysisStatus = (typeof AnalysisStatus)[number]

export interface AnalysisRunDTO {
  runId:        string
  status:       AnalysisStatus
  progressStep: string | null
  startedAt:    string
  completedAt:  string | null
  error:        string | null
  groupsFound:  number | null
  rowsFetched:  number | null
}

/** Opaque keyset cursor value stored as base64. */
export type PageCursor = string

export interface KeysetCursorPayload {
  sortValue: number | string
  id:        number | string
}
