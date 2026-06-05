import { withHandler } from '../../../../../server/http'
import { ContractError } from '../../../../../src/contracts/lib/contract-utils'
import { getProject } from '../../../../../server/repositories/project.repo'
import {
  createRun,
  getActiveRun,
  updateRunStatus,
} from '../../../../../server/repositories/analysis-run.repo'
import { launchAnalysisJob } from '../../../../../server/cloud-run'

export const runtime = 'nodejs'

// POST /api/projects/:id/analysis — trigger a fresh analysis run.
// Concurrency guard: a queued/running run for the project returns 409. There is
// no distributed lock (single-tenant, low traffic); the active-run read is the
// only protection (see Fase 5 brief).
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await context.params
  return withHandler({ protected: true }, async () => {
    const project = await getProject(projectId)
    if (project === null) throw new ContractError('not_found', 'Project not found')

    if ((await getActiveRun(projectId)) !== null) {
      throw new ContractError('conflict', 'Analisi già in corso')
    }

    const run = await createRun(projectId)
    try {
      await launchAnalysisJob(run.runId, projectId)
    } catch (err) {
      await updateRunStatus(run.runId, 'failed', {
        error: err instanceof Error ? err.message : 'Cloud Run job launch failed',
        completed: true,
      })
      throw new ContractError('internal_error', 'Failed to launch analysis job')
    }
    return { runId: run.runId }
  })(req)
}
