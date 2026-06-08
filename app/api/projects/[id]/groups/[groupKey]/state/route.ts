import { withHandler } from '@/server/http'
import { UpdateGroupStateSchema } from '@/src/contracts/schemas/requests'
import { upsertGroupState } from '@/server/repositories/misc.repo'
import { bqTimestampToISO } from '@/server/db/bq-helpers'
import { ContractError } from '@/src/contracts/lib/contract-utils'
import { log } from '@/server/log'
import type { GroupStatus } from '@/src/contracts/types/domain'

type Ctx = { params: Promise<{ id: string; groupKey: string }> }

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: projectId, groupKey } = await ctx.params
  return withHandler({ protected: true, schema: UpdateGroupStateSchema }, async ({ requestId, parsed }) => {
    if (groupKey === '') throw new ContractError('not_found', 'Group not found')
    const row = await upsertGroupState(projectId, groupKey, parsed)
    log.info(requestId, 'group_state.updated', {
      projectId,
      meta: { groupKey, status: row.status },
    })
    return {
      groupKey,
      status:    row.status as GroupStatus,
      notes:     row.notes,
      updatedAt: bqTimestampToISO(row.updated_at) as string,
    }
  })(req)
}
