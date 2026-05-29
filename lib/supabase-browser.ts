import { createBrowserClient } from '@supabase/ssr'

function getEnv(): { url: string; anonKey: string } {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  }
  return { url, anonKey }
}

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getEnv()
  return createBrowserClient(url, anonKey)
}
