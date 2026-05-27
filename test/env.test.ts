import { describe, it, expect } from 'vitest'
import { envSchema, parseEnv } from '../src/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_URL: 'https://example.com',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
  TOKEN_ENC_KEY: 'a'.repeat(32),
  CRON_SECRET: 'b'.repeat(16),
  GSC_CLIENT_ID: 'gsc-id',
  GSC_CLIENT_SECRET: 'gsc-secret',
}

describe('envSchema', () => {
  it('accepts a fully valid env', () => {
    expect(envSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TOKEN_ENC_KEY',
    'CRON_SECRET',
    'GSC_CLIENT_ID',
    'GSC_CLIENT_SECRET',
  ])('rejects missing %s', (key) => {
    const copy: Record<string, string | undefined> = { ...valid }
    delete copy[key]
    expect(envSchema.safeParse(copy).success).toBe(false)
  })

  it('rejects an invalid URL for NEXT_PUBLIC_SUPABASE_URL', () => {
    expect(
      envSchema.safeParse({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }).success,
    ).toBe(false)
  })

  it('rejects TOKEN_ENC_KEY shorter than 32 chars', () => {
    expect(
      envSchema.safeParse({ ...valid, TOKEN_ENC_KEY: 'short' }).success,
    ).toBe(false)
  })

  it('rejects CRON_SECRET shorter than 16 chars', () => {
    expect(
      envSchema.safeParse({ ...valid, CRON_SECRET: 'tooshort' }).success,
    ).toBe(false)
  })
})

describe('parseEnv', () => {
  it('returns the typed env on valid input', () => {
    const result = parseEnv(valid)
    expect(result.NEXT_PUBLIC_SUPABASE_URL).toBe(valid.NEXT_PUBLIC_SUPABASE_URL)
    expect(result.TOKEN_ENC_KEY).toBe(valid.TOKEN_ENC_KEY)
  })

  it('throws on missing required var and names it', () => {
    const { CRON_SECRET: _omit, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow('CRON_SECRET')
  })

  it('throws with "Missing or invalid env" prefix', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow('Missing or invalid env')
  })
})
