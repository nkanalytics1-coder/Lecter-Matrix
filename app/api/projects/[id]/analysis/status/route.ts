import { withHandler } from '../../../../../../server/http'
import { ContractError } from '../../../../../../src/contracts/lib/contract-utils'
import { getLatestRun } from '../../../../../../server/repositories/analysis-run.repo'

export const runtime = 'nodejs'

// GET /api/projects/:id/analysis/status — current state of the most recent run.
// Read-only and immediate: returns the latest analysis_run (started_at DESC).
// The client polls this; we never wait on the run here. 404 when no run exists.
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await context.params
  return withHandler({ protected: true }, async () => {
    const run = await getLatestRun(projectId)
    if (run === null) throw new ContractError('not_found', 'No analysis run found for project')
    return run
  })(req)
}
