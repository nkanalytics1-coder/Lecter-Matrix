import { createHmac, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { withHandler } from '@/server/http'
import { ContractError } from '@/src/contracts/lib/contract-utils'
import { getProject } from '@/server/repositories/project.repo'
import { getConnection, setPending } from '@/server/repositories/connection.repo'
import { getEncKey } from '@/server/ingest/token-crypto'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: projectId } = await ctx.params
  return withHandler({ protected: true }, async ({ requestId: _requestId }) => {
    const project = await getProject(projectId)
    if (project === null) throw new ContractError('not_found', 'Project not found')

    const conn = await getConnection(projectId)
    if (conn !== null && conn.status === 'connected') {
      throw new ContractError('conflict', 'Project is already connected')
    }

    const key = getEncKey()
    const nonce = randomUUID()
    const payload = Buffer.from(JSON.stringify({ projectId, nonce })).toString('base64url')
    const sig = createHmac('sha256', key).update(payload).digest('hex')
    const stateFull = `${payload}.${sig}`

    const params = new URLSearchParams({
      client_id:     process.env['GSC_CLIENT_ID'] ?? '',
      redirect_uri:  process.env['GSC_REDIRECT_URI'] ?? '',
      response_type: 'code',
      scope:         GSC_SCOPE,
      access_type:   'offline',
      prompt:        'consent',
      state:         stateFull,
    })

    const cookieStore = await cookies()
    cookieStore.set('gsc_oauth_nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
      path: '/api/auth/gsc/callback',
    })

    await setPending(projectId)

    return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` }
  })(req)
}
