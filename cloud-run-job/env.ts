export interface JobEnv {
  runId: string
  projectId: string
  fetchStrategy: 'daily' | 'aggregated'
}

export function loadEnv(): JobEnv {
  const runId = process.env['RUN_ID']
  const projectId = process.env['PROJECT_ID']
  if (!runId) throw new Error('Missing required env: RUN_ID')
  if (!projectId) throw new Error('Missing required env: PROJECT_ID')
  const fetchStrategy = process.env['FETCH_STRATEGY'] === 'aggregated' ? 'aggregated' : 'daily'
  return { runId, projectId, fetchStrategy }
}
