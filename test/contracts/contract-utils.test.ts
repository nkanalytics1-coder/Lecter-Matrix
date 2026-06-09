import { describe, it, expect } from 'vitest'
import {
  ok,
  fail,
  encodeCursor,
  decodeCursor,
  backoffMs,
  ContractError,
} from '../../src/contracts/lib/contract-utils'
import type { KeysetCursorPayload } from '../../src/contracts/types/api'

// ── ok ─────────────────────────────────────────────────────────────────────────

describe('ok', () => {
  it('returns data with a null error', () => {
    const result = ok({ id: 1 })
    expect(result.data).toEqual({ id: 1 })
    expect(result.error).toBeNull()
  })

  it('works with primitive values', () => {
    const result = ok(42)
    expect(result.data).toBe(42)
    expect(result.error).toBeNull()
  })

  it('works with null data', () => {
    const result = ok(null)
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })
})

// ── fail ───────────────────────────────────────────────────────────────────────

describe('fail', () => {
  it('returns null data with a populated error', () => {
    const result = fail('not_found', 'project not found', 'req-123')
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe('not_found')
    expect(result.error?.message).toBe('project not found')
    expect(result.error?.requestId).toBe('req-123')
  })

  it('omits the details property when not provided', () => {
    const result = fail('internal_error', 'oops', 'req-456')
    const error = result.error
    expect(error).not.toBeNull()
    if (error !== null) {
      expect('details' in error).toBe(false)
    }
  })

  it('includes details when provided', () => {
    const result = fail('validation_error', 'bad input', 'req-789', { field: 'name' })
    expect(result.error?.details).toEqual({ field: 'name' })
  })

  it('accepts every valid ApiErrorCode', () => {
    const codes = [
      'validation_error', 'unauthorized', 'not_found', 'conflict',
      'rate_limited', 'gsc_auth_error', 'internal_error', 'unavailable',
    ] as const
    for (const code of codes) {
      const result = fail(code, 'msg', 'rid')
      expect(result.error?.code).toBe(code)
    }
  })
})

// ── cursor codec ───────────────────────────────────────────────────────────────

describe('encodeCursor / decodeCursor', () => {
  it('roundtrips a numeric sortValue', () => {
    const payload: KeysetCursorPayload = { sortValue: 95.5, id: 42 }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('roundtrips a string sortValue', () => {
    const payload: KeysetCursorPayload = { sortValue: 'https://example.com/page', id: 7 }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('roundtrips sortValue of 0', () => {
    const payload: KeysetCursorPayload = { sortValue: 0, id: 1 }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('returns null for undefined', () => {
    expect(decodeCursor(undefined)).toBeNull()
  })

  it('returns null for null', () => {
    expect(decodeCursor(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull()
  })

  it('returns null for a non-base64 string', () => {
    expect(decodeCursor('not!!!valid!!!base64')).toBeNull()
  })

  it('returns null for valid base64 with malformed JSON', () => {
    expect(decodeCursor(btoa('{not json}'))).toBeNull()
  })

  it('returns null for valid JSON missing id field', () => {
    expect(decodeCursor(btoa(JSON.stringify({ sortValue: 1 })))).toBeNull()
  })

  it('returns null for valid JSON missing sortValue field', () => {
    expect(decodeCursor(btoa(JSON.stringify({ id: 1 })))).toBeNull()
  })

  it('returns null for valid JSON with wrong sortValue type', () => {
    expect(decodeCursor(btoa(JSON.stringify({ sortValue: true, id: 1 })))).toBeNull()
  })

  it('returns null for valid JSON with wrong id type', () => {
    // id must be number or string; boolean is invalid
    expect(decodeCursor(btoa(JSON.stringify({ sortValue: 1, id: true })))).toBeNull()
  })

  it('roundtrips a string id (BQ UUID)', () => {
    const payload = { sortValue: 1, id: 'abc-uuid-string' }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('returns null when the JSON is an array, not an object', () => {
    expect(decodeCursor(btoa(JSON.stringify([1, 2, 3])))).toBeNull()
  })

  it('returns null for an empty JSON object (both fields missing)', () => {
    expect(decodeCursor(btoa(JSON.stringify({})))).toBeNull()
  })
})

// ── backoffMs ──────────────────────────────────────────────────────────────────

describe('backoffMs', () => {
  it('is monotone on average across attempts 0-5 (uncapped range)', () => {
    const N = 200
    // attempt 5: 1000 * 2^5 = 32000 < 64000 cap — all averages should grow
    const avgs = [0, 1, 2, 3, 4, 5].map(attempt => {
      let sum = 0
      for (let i = 0; i < N; i++) sum += backoffMs(attempt, 1000, 64000)
      return sum / N
    })
    for (let i = 1; i < avgs.length; i++) {
      expect(avgs[i]).toBeGreaterThan(avgs[i - 1])
    }
  })

  it('always respects capMs at high attempt values', () => {
    for (let i = 0; i < 100; i++) {
      expect(backoffMs(20, 1000, 64000)).toBeLessThanOrEqual(64000)
    }
  })

  it('jitter keeps every sample within ±20% of the base formula (uncapped)', () => {
    const baseMs = 1000
    const attempt = 2  // raw = 4000, well below 64000 cap
    const raw = baseMs * Math.pow(2, attempt)
    for (let i = 0; i < 200; i++) {
      const result = backoffMs(attempt, baseMs, 64000)
      expect(result).toBeGreaterThanOrEqual(raw * 0.8)
      expect(result).toBeLessThan(raw * 1.2 + 1e-9)
    }
  })

  it('uses 1000ms base and 64000ms cap as defaults', () => {
    for (let i = 0; i < 50; i++) {
      const result = backoffMs(0)
      expect(result).toBeGreaterThanOrEqual(800)
      expect(result).toBeLessThan(1201)
    }
  })

  it('respects a custom capMs', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffMs(10, 100, 500)).toBeLessThanOrEqual(500)
    }
  })
})

// ── ContractError ──────────────────────────────────────────────────────────────

describe('ContractError', () => {
  it('is an instance of Error and ContractError', () => {
    const err = new ContractError('not_found', 'missing resource')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ContractError)
  })

  it('has name set to ContractError', () => {
    const err = new ContractError('internal_error', 'something broke')
    expect(err.name).toBe('ContractError')
  })

  it('exposes the message', () => {
    const err = new ContractError('not_found', 'project not found')
    expect(err.message).toBe('project not found')
  })

  it('exposes the code', () => {
    const err = new ContractError('validation_error', 'bad input')
    expect(err.code).toBe('validation_error')
  })

  it('has no details property when not provided', () => {
    const err = new ContractError('not_found', 'missing')
    expect(err.details).toBeUndefined()
    expect('details' in err).toBe(false)
  })

  it('exposes details when provided', () => {
    const err = new ContractError('validation_error', 'bad input', { field: 'email' })
    expect(err.details).toEqual({ field: 'email' })
  })

  it('details can be any unknown value', () => {
    const err = new ContractError('internal_error', 'fail', [1, 2, 3])
    expect(err.details).toEqual([1, 2, 3])
  })

  it('can be thrown and caught as an Error', () => {
    expect(() => {
      throw new ContractError('unauthorized', 'not allowed')
    }).toThrow(ContractError)
  })

  it('can be caught and checked by instanceof', () => {
    try {
      throw new ContractError('conflict', 'duplicate key')
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError)
      if (e instanceof ContractError) {
        expect(e.code).toBe('conflict')
      }
    }
  })
})
