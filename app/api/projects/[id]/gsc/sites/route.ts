import { withHandler } from '@/server/http'
import { ContractError } from '@/src/contracts/lib/contract-utils'
import { getProject } from '@/server/repositories/project.repo'
import { getConnection } from '@/server/repositories/connection.repo'
import { decrypt, getEncKey } from '@/server/ingest/token-crypto'
import { refreshAccessToken, listSites } from '@/server/ingest/gsc-client'

// GET /api/projects/[id]/gsc/sites
// Lists the GSC properties the connected account can access, so the onboarding
// wizard can present them as a dropdown after OAuth completes.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: projectId } = await ctx.params
  return withHandler({ protected: true }, async () => {
    const project = await getProject(projectId)
    if (project === null) throw new ContractError('not_found', 'Project not found')

    const conn = await getConnection(projectId)
    if (conn === null || conn.status !== 'connected' || conn.refresh_token_enc === '') {
      throw new ContractError('gsc_auth_error', 'GSC connection is not ready')
    }

    const refreshToken = decrypt(conn.refresh_token_enc, getEncKey())
    const accessToken = await refreshAccessToken(refreshToken)
    const sites = await listSites(accessToken)

    return { sites }
  })(req)
}
