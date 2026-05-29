import type { ApiResult } from '@/src/contracts/types/api'

/**
 * Typed fetch wrapper returning ApiResult<T>.
 * - Network errors   → throw
 * - 5xx             → throw
 * - 4xx domain errors → ApiResult.error (no throw)
 */
export async function apiClient<T>(
  url: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (err) {
    throw new Error(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (res.status >= 500) {
    throw new Error(`Server error ${res.status}`)
  }

  return (await res.json()) as ApiResult<T>
}
