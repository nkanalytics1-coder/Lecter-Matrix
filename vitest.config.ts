import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(root),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    fileParallelism: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      NEXT_PUBLIC_URL: 'https://localhost:3000',
      CRON_SECRET: 'bbbbbbbbbbbbbbbb',
      GSC_CLIENT_ID: 'test-gsc-client-id',
      GSC_CLIENT_SECRET: 'test-gsc-client-secret',
      GSC_REDIRECT_URI: 'http://localhost:3000/api/auth/gsc/callback',
      // 32 zero-bytes in base64 — used only for token-crypto unit tests
      TOKEN_ENC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      GCP_PROJECT_ID: 'test-gcp-project',
    },
  },
})
