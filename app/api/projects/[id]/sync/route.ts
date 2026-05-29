import { withHandler } from '../../../../../server/http'
import { syncProject } from '../../../../../server/cron/tick'

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await context.params
  return withHandler({ protected: true }, async () => {
    return syncProject(projectId)
  })(req)
}
