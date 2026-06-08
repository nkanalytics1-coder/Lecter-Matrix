import { describe, it, expect } from 'vitest'
import { envSchema, parseEnv } from '../src/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  NEXT_PUBLIC_URL: 'https://example.com',
  CRON_SECRET: 'b'.repeat(16),
  GSC_CLIENT_ID: 'test-client-id',
  GSC_CLIENT_SECRET: 'test-client-secret',
  GSC_REDIRECT_URI: 'http://localhost:3000/api/auth/gsc/callback',
  TOKEN_ENC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  GCP_PROJECT_ID: 'test-gcp-project',
}

describe('envSchema', () => {
  it('accepts a fully valid env', () => {
    expect(envSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_URL',
    'CRON_SECRET',
    'GSC_CLIENT_ID',
    'GSC_CLIENT_SECRET',
    'GSC_REDIRECT_URI',
    'TOKEN_ENC_KEY',
    'GCP_PROJECT_ID',
  ])('rejects missing %s', (key) => {
    const copy: Record<string, string | undefined> = { ...valid }
    delete copy[key]
    expect(envSchema.safeParse(copy).success).toBe(false)
  })

  it('applies BQ_DATASET default when absent', () => {
    const result = envSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.BQ_DATASET).toBe('gsc_data')
  })

  it('applies BQ_LOCATION default when absent', () => {
    const result = envSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.BQ_LOCATION).toBe('EU')
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
    expect(result.GCP_PROJECT_ID).toBe(valid.GCP_PROJECT_ID)
    expect(result.CRON_SECRET).toBe(valid.CRON_SECRET)
  })

  it('throws on missing required var and names it', () => {
    const { CRON_SECRET: _omit, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow('CRON_SECRET')
  })

  it('throws with "Missing or invalid env" prefix', () => {
    const { GCP_PROJECT_ID: _omit, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow('Missing or invalid env')
  })
})
