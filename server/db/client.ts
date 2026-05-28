import 'server-only'
import postgres from 'postgres'

type GlobalWithPg = typeof globalThis & { _pgClient?: postgres.Sql }

export function serviceClient(): postgres.Sql {
  const g = globalThis as GlobalWithPg
  const existing = g._pgClient
  if (existing) return existing
  const url = process.env['SUPABASE_DB_URL']
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  const client = postgres(url)
  g._pgClient = client
  return client
}
