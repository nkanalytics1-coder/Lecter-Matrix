import 'server-only'
import { BigQuery } from '@google-cloud/bigquery'
import type { Query } from '@google-cloud/bigquery'

type GlobalWithBq = typeof globalThis & { _bqClient?: BigQuery }

export function bqClient(): BigQuery {
  const g = globalThis as GlobalWithBq
  if (g._bqClient !== undefined) return g._bqClient

  const projectId = process.env['GCP_PROJECT_ID'] ?? 'lecter-matrix-prod'
  const jsonStr = process.env['GCP_SERVICE_ACCOUNT_JSON']

  let client: BigQuery
  if (jsonStr) {
    const credentials = JSON.parse(jsonStr) as Record<string, string>
    client = new BigQuery({ projectId, credentials })
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var (file path)
    client = new BigQuery({ projectId })
  }

  g._bqClient = client
  return client
}

export function bqTable(name: string): string {
  const project = process.env['GCP_PROJECT_ID'] ?? 'lecter-matrix-prod'
  const dataset = process.env['BQ_DATASET'] ?? 'gsc_data'
  return `\`${project}.${dataset}.${name}\``
}

export function bqLocation(): string {
  return process.env['BQ_LOCATION'] ?? 'europe-west1'
}

// BQ named-param type spec for ARRAY params: { paramName: ['STRING'] }
// Subset of QueryParamTypeStruct used internally by @google-cloud/bigquery.
export type BqParamTypes = Record<string, string[]>

export async function bqQuery<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {},
  types: BqParamTypes = {},
): Promise<T[]> {
  const bq = bqClient()
  const opts: Query = {
    query,
    params,
    location: bqLocation(),
  }
  if (Object.keys(types).length > 0) {
    opts.types = types
  }
  const [rows] = await bq.query(opts)
  return rows as T[]
}

export async function bqDml(
  query: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  await bqQuery(query, params)
}
