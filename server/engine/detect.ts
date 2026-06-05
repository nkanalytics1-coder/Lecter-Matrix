import 'server-only'
import { createHash } from 'node:crypto'
import { bqQuery, bqTable } from '../db/bq-client'
import {
  pickWinner,
  pickDominant,
  cannType as deriveCannType,
  severity as scoreSeverity,
  lostClicks as scoreLostClicks,
  benign as scoreBenign,
} from './scoring'
import type { ScoringMember } from './scoring'
import { recommendedAction } from './action-table'
import { detectIntent, slugTokens, DEFAULT_SIGNALS } from '../ingest/normalize'
import type { IntentSignals } from '../ingest/normalize'
import type { PageType } from '../../src/contracts/types/domain'
import type { ProjectConfig } from '../../src/contracts/schemas/project-config'
import { log } from '../log'

const DEFAULTS = {
  min_members: 2,
  min_group_impressions: 100,
  min_member_impressions: 10,
  max_members: 6,
} as const

// Rows are written to persistent tables in chunked VALUES INSERTs of this size.
const INSERT_CHUNK = 1000

// Aggregated row as returned by BigQuery: INT64 columns arrive as strings.
interface RawMemberRow {
  query_norm: string
  page: string
  page_type: string
  total_clicks: string // BQ INT64 → string
  total_impressions: string // BQ INT64 → string
  weighted_position: number // BQ FLOAT64
}

interface MemberAgg {
  queryNorm: string
  page: string
  pageType: string
  totalClicks: number
  totalImpressions: number
  weightedPosition: number
}

interface GroupInsertRow {
  group_key: string
  query_norm: string
  query_intent: string
  member_count: number
  severity_score: number
  cann_type: string
  winner_page: string
  should_win_page: string
  inversion: boolean
  benign: boolean
  benign_reason: string | null
  recommended_action: string
  total_clicks: number
  total_impressions: number
  lost_clicks: number
}

interface MemberInsertRow {
  group_key: string
  page: string
  page_type: string
  clicks: number
  impressions: number
  weighted_position: number
  is_winner: boolean
}

function buildGroupKey(projectId: string, queryNorm: string, pages: string[]): string {
  const sorted = [...pages].sort().join(',')
  return createHash('sha256').update(`${projectId}|${queryNorm}|${sorted}`).digest('hex')
}

function pageSlugJaccard(a: string, b: string): number {
  const sa = new Set(slugTokens(a))
  const sb = new Set(slugTokens(b))
  const intersection = [...sa].filter(t => sb.has(t)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 1 : intersection / union
}

// Fully-qualified transient table for this run. run_id is a standard UUID (with
// hyphens); table names cannot be bound parameters, so it is interpolated after a
// strict allowlist check to keep the statement injection-safe.
function tempTable(runId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error(`detect: invalid runId for temp table name: ${runId}`)
  }
  return bqTable(`gsc_metric_temp_${runId}`)
}

// ── Chunked INSERTs ──────────────────────────────────────────────────────────────
// BigQuery has no multi-statement transaction that spans separate jobs, and the
// existing bqQuery helper types array params as scalar arrays only (no struct
// arrays), so UNNEST(@rows) of nullable structs is not expressible here. We emit
// VALUES with per-row named scalar params, chunked at INSERT_CHUNK rows.

async function insertGroups(
  projectId: string,
  runId: string,
  rows: readonly GroupInsertRow[],
): Promise<void> {
  const table = bqTable('cannibalization_group')
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const params: Record<string, unknown> = { project_id: projectId, run_id: runId }
    const tuples = chunk.map((r, j) => {
      const p = `g${j}_`
      params[`${p}group_key`] = r.group_key
      params[`${p}query_norm`] = r.query_norm
      params[`${p}query_intent`] = r.query_intent
      params[`${p}member_count`] = r.member_count
      params[`${p}severity_score`] = r.severity_score
      params[`${p}cann_type`] = r.cann_type
      params[`${p}winner_page`] = r.winner_page
      params[`${p}should_win_page`] = r.should_win_page
      params[`${p}inversion`] = r.inversion
      params[`${p}benign`] = r.benign
      params[`${p}recommended_action`] = r.recommended_action
      params[`${p}total_clicks`] = r.total_clicks
      params[`${p}total_impressions`] = r.total_impressions
      params[`${p}lost_clicks`] = r.lost_clicks
      let benignReasonExpr = 'NULL'
      if (r.benign_reason !== null) {
        params[`${p}benign_reason`] = r.benign_reason
        benignReasonExpr = `@${p}benign_reason`
      }
      return (
        `(@project_id, @${p}group_key, @run_id, @${p}query_norm, @${p}query_intent, NULL, ` +
        `@${p}member_count, @${p}severity_score, @${p}cann_type, @${p}winner_page, @${p}should_win_page, ` +
        `@${p}inversion, @${p}benign, ${benignReasonExpr}, @${p}recommended_action, ` +
        `@${p}total_clicks, @${p}total_impressions, @${p}lost_clicks, CURRENT_TIMESTAMP())`
      )
    })
    const sql = `
      INSERT INTO ${table} (
        project_id, group_key, run_id, query_norm, query_intent, search_volume,
        member_count, severity_score, cann_type, winner_page, should_win_page,
        inversion, benign, benign_reason, recommended_action,
        total_clicks, total_impressions, lost_clicks, detected_at
      ) VALUES
      ${tuples.join(',\n      ')}
    `
    await bqQuery(sql, params)
  }
}

async function insertMembers(
  projectId: string,
  runId: string,
  rows: readonly MemberInsertRow[],
): Promise<void> {
  const table = bqTable('cannibalization_member')
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const params: Record<string, unknown> = { project_id: projectId, run_id: runId }
    const tuples = chunk.map((r, j) => {
      const p = `m${j}_`
      params[`${p}group_key`] = r.group_key
      params[`${p}page`] = r.page
      params[`${p}page_type`] = r.page_type
      params[`${p}clicks`] = r.clicks
      params[`${p}impressions`] = r.impressions
      params[`${p}weighted_position`] = r.weighted_position
      params[`${p}is_winner`] = r.is_winner
      return (
        `(@project_id, @${p}group_key, @run_id, @${p}page, @${p}page_type, ` +
        `@${p}clicks, @${p}impressions, @${p}weighted_position, @${p}is_winner)`
      )
    })
    const sql = `
      INSERT INTO ${table} (
        project_id, group_key, run_id, page, page_type,
        clicks, impressions, weighted_position, is_winner
      ) VALUES
      ${tuples.join(',\n      ')}
    `
    await bqQuery(sql, params)
  }
}

// ── Detection ────────────────────────────────────────────────────────────────────

export async function runDetection(
  projectId: string,
  runId: string,
  config: ProjectConfig,
): Promise<{ runId: string; groupsFound: number }> {
  const reqId = `detect:${runId}`

  const cfg = {
    min_members: config.min_members ?? DEFAULTS.min_members,
    min_group_impressions: config.min_group_impressions ?? DEFAULTS.min_group_impressions,
    min_member_impressions: config.min_member_impressions ?? DEFAULTS.min_member_impressions,
    max_members: config.max_members ?? DEFAULTS.max_members,
  }

  const intentSignals: IntentSignals = {
    informational: DEFAULT_SIGNALS.informational,
    transactional: config.intent_signals_extra?.length
      ? [...DEFAULT_SIGNALS.transactional, ...config.intent_signals_extra]
      : DEFAULT_SIGNALS.transactional,
    brandTerms: config.brand_terms ?? DEFAULT_SIGNALS.brandTerms,
  }

  // One SQL pass over the transient table: aggregate (query_norm, page) across the
  // 90-day window. The temp table is already scoped to this run/project, so no
  // project_id or date filter is needed (see BIGQUERY_DESIGN.md § 6).
  const raw = await bqQuery<RawMemberRow>(`
    SELECT
      query_norm,
      page,
      page_type,
      CAST(SUM(clicks) AS INT64)                                 AS total_clicks,
      CAST(SUM(impressions) AS INT64)                            AS total_impressions,
      SUM(position * impressions) / NULLIF(SUM(impressions), 0)  AS weighted_position
    FROM ${tempTable(runId)}
    WHERE impressions >= 1
    GROUP BY query_norm, page, page_type
  `)

  // Bucket by query_norm; drop members below the impression threshold.
  const byQuery = new Map<string, MemberAgg[]>()
  for (const row of raw) {
    const totalImpressions = Number(row.total_impressions)
    if (totalImpressions < cfg.min_member_impressions) continue
    const agg: MemberAgg = {
      queryNorm: row.query_norm,
      page: row.page,
      pageType: row.page_type,
      totalClicks: Number(row.total_clicks),
      totalImpressions,
      weightedPosition: row.weighted_position,
    }
    const list = byQuery.get(agg.queryNorm)
    if (list !== undefined) list.push(agg)
    else byQuery.set(agg.queryNorm, [agg])
  }

  // Apply group gates; cap members by impressions.
  const candidates: Array<{ queryNorm: string; members: MemberAgg[] }> = []
  for (const [queryNorm, members] of byQuery) {
    if (members.length < cfg.min_members) continue
    const totalImpr = members.reduce((s, m) => s + m.totalImpressions, 0)
    if (totalImpr < cfg.min_group_impressions) continue
    const capped = [...members]
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, cfg.max_members)
    candidates.push({ queryNorm, members: capped })
  }

  const groupRows: GroupInsertRow[] = []
  const memberRows: MemberInsertRow[] = []

  for (const { queryNorm, members } of candidates) {
    try {
      const scoringMembers: ScoringMember[] = members.map(m => ({
        page: m.page,
        pageType: m.pageType as PageType,
        clicks: m.totalClicks,
        impressions: m.totalImpressions,
        position: m.weightedPosition,
      }))

      const intent = detectIntent(queryNorm, intentSignals)
      const winner = pickWinner(scoringMembers)
      const dominant = pickDominant(scoringMembers, intent)
      const ct = deriveCannType(scoringMembers)
      const sev = scoreSeverity(scoringMembers)
      const lost = scoreLostClicks(scoringMembers)
      const benignResult = scoreBenign(scoringMembers)
      const inversion = winner.page !== dominant.page

      const byImpr = [...scoringMembers].sort((a, b) => b.impressions - a.impressions)
      const jac = byImpr.length >= 2 ? pageSlugJaccard(byImpr[0]!.page, byImpr[1]!.page) : 0

      const action = recommendedAction({
        cannType: ct,
        intent,
        winnerPageType: winner.pageType,
        slugJaccard: jac,
        benignResult,
      })

      const key = buildGroupKey(projectId, queryNorm, members.map(m => m.page))
      const totalClicks = members.reduce((s, m) => s + m.totalClicks, 0)
      const totalImpressions = members.reduce((s, m) => s + m.totalImpressions, 0)

      groupRows.push({
        group_key: key,
        query_norm: queryNorm,
        query_intent: intent,
        member_count: scoringMembers.length,
        severity_score: sev,
        cann_type: ct,
        winner_page: winner.page,
        should_win_page: dominant.page,
        inversion,
        benign: benignResult.benign,
        benign_reason: benignResult.reason,
        recommended_action: action,
        total_clicks: totalClicks,
        total_impressions: totalImpressions,
        lost_clicks: lost,
      })

      for (const m of scoringMembers) {
        memberRows.push({
          group_key: key,
          page: m.page,
          page_type: m.pageType,
          clicks: m.clicks,
          impressions: m.impressions,
          weighted_position: m.position,
          is_winner: m.page === winner.page,
        })
      }
    } catch (err) {
      log.error(reqId, 'detect.group_error', {
        projectId,
        meta: { queryNorm, error: String(err) },
      })
    }
  }

  // Replace this project's results. BigQuery cannot wrap chunked, multi-job DML in
  // a single transaction, so we delete-then-insert sequentially: each run fully
  // overwrites the project's rows (see BIGQUERY_DESIGN.md § 4). On worker failure
  // the run is marked failed and the next successful run replaces everything.
  await bqQuery(
    `DELETE FROM ${bqTable('cannibalization_group')} WHERE project_id = @project_id`,
    { project_id: projectId },
  )
  await bqQuery(
    `DELETE FROM ${bqTable('cannibalization_member')} WHERE project_id = @project_id`,
    { project_id: projectId },
  )

  await insertGroups(projectId, runId, groupRows)
  await insertMembers(projectId, runId, memberRows)

  // Prune orphaned triage: group_state keys no longer produced by detection.
  await bqQuery(
    `
    DELETE FROM ${bqTable('group_state')}
    WHERE project_id = @project_id
      AND group_key NOT IN (
        SELECT group_key FROM ${bqTable('cannibalization_group')}
        WHERE project_id = @project_id
      )
    `,
    { project_id: projectId },
  )

  const groupsFound = groupRows.length
  log.info(reqId, 'detect.run_succeeded', { projectId, meta: { groupsFound } })
  return { runId, groupsFound }
}
