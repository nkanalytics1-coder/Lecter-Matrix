import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  }
  return { url, anonKey }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // Cron routes are protected by CRON_SECRET in their handler, not here
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  const { url, anonKey } = supabaseEnv()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user !== null) return response

  // API routes (except cron, excluded above) → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'unauthorized',
          message: 'Not authenticated',
          requestId: crypto.randomUUID(),
        },
      },
      { status: 401 },
    )
  }

  // Page routes under /p/* → redirect to /login
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/p/:path*', '/api/:path*'],
}
