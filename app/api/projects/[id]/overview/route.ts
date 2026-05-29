import { withHandler } from '@/server/http'
import { getOverview } from '@/server/repositories/misc.repo'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: projectId } = await ctx.params
  return withHandler({ protected: true }, async () => getOverview(projectId))(req)
}
