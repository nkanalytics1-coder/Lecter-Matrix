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
    // DB test files mutate shared Postgres schema; serialise all files so they
    // never run concurrently (prevents ECONNRESET / "relation does not exist").
    // fileParallelism:false overrides maxWorkers to 1 (Vitest 4 API).
    // The suite is small so the throughput cost is negligible.
    fileParallelism: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      NEXT_PUBLIC_URL: 'https://localhost:3000',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      CRON_SECRET: 'bbbbbbbbbbbbbbbb',
    },
  },
})
