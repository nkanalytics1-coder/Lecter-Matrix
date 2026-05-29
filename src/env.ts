import { z } from 'zod'

export const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  GSC_CLIENT_ID: z.string().min(1),
  GSC_CLIENT_SECRET: z.string().min(1),
  GSC_REDIRECT_URI: z.string().url(),
  TOKEN_ENC_KEY: z.string().min(44).max(44),
  DATABASE_URL_TEST: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const keys = result.error.issues.map(e => e.path.join('.')).join(', ')
    throw new Error(`Missing or invalid env: ${keys}`)
  }
  return result.data
}

export const env: Env = parseEnv(process.env)
