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

/** Opaque keyset cursor value stored as base64. */
export type PageCursor = string

export interface KeysetCursorPayload {
  sortValue: number | string
  id:        number
}
