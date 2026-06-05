import 'server-only'
import { JobsClient } from '@google-cloud/run'

// Cached singleton — the gRPC client is expensive to construct and safe to reuse.
type GlobalWithRun = typeof globalThis & { _runJobsClient?: JobsClient }

// Reuses the same credential resolution as bqClient: explicit service-account
// JSON via GCP_SERVICE_ACCOUNT_JSON, else Application Default Credentials.
function jobsClient(): JobsClient {
  const g = globalThis as GlobalWithRun
  if (g._runJobsClient !== undefined) return g._runJobsClient

  const projectId = process.env['GCP_PROJECT_ID'] ?? 'lecter-matrix-prod'
  const jsonStr = process.env['GCP_SERVICE_ACCOUNT_JSON']

  const client = jsonStr
    ? new JobsClient({ projectId, credentials: JSON.parse(jsonStr) as Record<string, string> })
    : new JobsClient({ projectId })

  g._runJobsClient = client
  return client
}

// Launches the analysis Cloud Run Job via the Admin API
// (run.googleapis.com/v2 projects.locations.jobs.run), injecting run_id and
// project_id as container env overrides. The Fase 6 container reads RUN_ID /
// PROJECT_ID to know which run to execute.
//
// runJob returns a long-running operation; we await only the call that creates
// the execution (enqueue), never operation.promise() — the job runs detached
// and reports progress back through the analysis_run table.
export async function launchAnalysisJob(runId: string, projectId: string): Promise<void> {
  const gcpProject = process.env['GCP_PROJECT_ID'] ?? 'lecter-matrix-prod'
  const location = process.env['GCP_LOCATION'] ?? 'europe-west1'
  const jobName = process.env['CLOUD_RUN_JOB_NAME'] ?? 'lecter-matrix-analysis-job'
  const name = `projects/${gcpProject}/locations/${location}/jobs/${jobName}`

  await jobsClient().runJob({
    name,
    overrides: {
      containerOverrides: [
        {
          env: [
            { name: 'RUN_ID', value: runId },
            { name: 'PROJECT_ID', value: projectId },
          ],
        },
      ],
    },
  })
}
