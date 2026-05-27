import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      NEXT_PUBLIC_URL: 'https://localhost:3000',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      TOKEN_ENC_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      CRON_SECRET: 'bbbbbbbbbbbbbbbb',
      GSC_CLIENT_ID: 'test-gsc-client-id',
      GSC_CLIENT_SECRET: 'test-gsc-client-secret',
    },
  },
})
