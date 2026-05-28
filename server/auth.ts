import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ContractError } from '@/src/contracts/lib/contract-utils'

function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  }
  return { url, anonKey }
}

export async function createAnonClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseEnv()
  const cookieStore = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component where cookies are read-only — safe to ignore
        }
      },
    },
  })
}

export async function requireSession(): Promise<User> {
  const client = await createAnonClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error !== null || user === null) {
    throw new ContractError('unauthorized', 'Not authenticated')
  }
  return user
}
