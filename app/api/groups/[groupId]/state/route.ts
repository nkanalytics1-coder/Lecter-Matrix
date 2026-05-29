import { withHandler } from '@/server/http'
import { UpdateGroupStateSchema } from '@/src/contracts/schemas/requests'
import { getGroupProjectKey } from '@/server/repositories/group.repo'
import { upsertGroupState } from '@/server/repositories/misc.repo'
import { ContractError } from '@/src/contracts/lib/contract-utils'
import { log } from '@/server/log'
import type { GroupStatus } from '@/src/contracts/types/domain'

type Ctx = { params: Promise<{ groupId: string }> }

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { groupId: raw } = await ctx.params
  return withHandler({ protected: true, schema: UpdateGroupStateSchema }, async ({ requestId, parsed }) => {
    const groupId = parseInt(raw, 10)
    if (isNaN(groupId)) throw new ContractError('not_found', 'Group not found')
    const loc = await getGroupProjectKey(groupId)
    if (loc === null) throw new ContractError('not_found', 'Group not found')
    const row = await upsertGroupState(loc.projectId, loc.groupKey, parsed)
    log.info(requestId, 'group_state.updated', {
      projectId: loc.projectId,
      meta: { groupKey: loc.groupKey, status: row.status },
    })
    return {
      groupKey:  loc.groupKey,
      status:    row.status as GroupStatus,
      notes:     row.notes,
      updatedAt: row.updated_at.toISOString(),
    }
  })(req)
}
