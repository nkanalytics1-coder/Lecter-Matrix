import { withHandler } from '@/server/http'
import { GroupListQuerySchema } from '@/src/contracts/schemas/requests'
import { listGroups } from '@/server/repositories/group.repo'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: projectId } = await ctx.params
  return withHandler({ protected: true, schema: GroupListQuerySchema }, async ({ parsed }) => {
    return listGroups(projectId, parsed)
  })(req)
}
