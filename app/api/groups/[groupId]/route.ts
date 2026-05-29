import { withHandler } from '@/server/http'
import { getGroupDrill } from '@/server/repositories/group.repo'
import { ContractError } from '@/src/contracts/lib/contract-utils'

type Ctx = { params: Promise<{ groupId: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { groupId: raw } = await ctx.params
  return withHandler({ protected: true }, async () => {
    const groupId = parseInt(raw, 10)
    if (isNaN(groupId)) throw new ContractError('not_found', 'Group not found')
    const group = await getGroupDrill(groupId)
    if (group === null) throw new ContractError('not_found', 'Group not found')
    return group
  })(req)
}
