import { withHandler } from '@/server/http'
import { getGroupDrill } from '@/server/repositories/group.repo'
import { ContractError } from '@/src/contracts/lib/contract-utils'

type Ctx = { params: Promise<{ id: string; groupKey: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: projectId, groupKey } = await ctx.params
  return withHandler({ protected: true }, async () => {
    if (groupKey === '') throw new ContractError('not_found', 'Group not found')
    const group = await getGroupDrill(projectId, groupKey)
    if (group === null) throw new ContractError('not_found', 'Group not found')
    return group
  })(req)
}
