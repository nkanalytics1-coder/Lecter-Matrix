import { withHandler } from '@/server/http'
import { ContractError } from '@/src/contracts/lib/contract-utils'
import { getProject } from '@/server/repositories/project.repo'
import { getConnection, disconnectProject } from '@/server/repositories/connection.repo'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: projectId } = await ctx.params
  return withHandler({ protected: true }, async ({ requestId: _requestId }) => {
    const project = await getProject(projectId)
    if (project === null) throw new ContractError('not_found', 'Project not found')

    const conn = await getConnection(projectId)
    if (conn === null) {
      throw new ContractError('not_found', 'No GSC connection for this project')
    }

    await disconnectProject(projectId)

    // Best-effort: attempt token revocation at Google (fire-and-forget)
    if (conn.access_token !== null) {
      const token = conn.access_token
      void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      }).catch(() => undefined)
    }

    return { disconnected: true }
  })(req)
}
