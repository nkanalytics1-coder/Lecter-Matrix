import 'server-only'
import { createHash } from 'node:crypto'
import { serviceClient } from '../db/client'
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

interface RawMemberRow {
  query_norm: string
  page: string
  page_type: string
  total_clicks: number
  total_impressions: number
  weighted_position: number
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

export async function runDetection(
  projectId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ runId: string; groupsFound: number }> {
  const sql = serviceClient()

  const [runRow] = await sql<{ id: string }[]>`
    INSERT INTO detection_run (project_id, window_start, window_end, status)
    VALUES (${projectId}, ${windowStart}::date, ${windowEnd}::date, 'running')
    RETURNING id
  `
  if (!runRow) throw new Error('detect: failed to insert detection_run')
  const runId = runRow.id
  const reqId = `detect:${runId}`

  try {
    const [projRow] = await sql<{ config: ProjectConfig }[]>`
      SELECT config FROM project WHERE id = ${projectId}
    `
    const rawCfg: ProjectConfig =
      typeof projRow?.config === 'string'
        ? (JSON.parse(projRow.config) as ProjectConfig)
        : (projRow?.config ?? {})
    const cfg = {
      min_members:           rawCfg.min_members           ?? DEFAULTS.min_members,
      min_group_impressions: rawCfg.min_group_impressions ?? DEFAULTS.min_group_impressions,
      min_member_impressions:rawCfg.min_member_impressions?? DEFAULTS.min_member_impressions,
      max_members:           rawCfg.max_members           ?? DEFAULTS.max_members,
    }

    const intentSignals: IntentSignals = {
      informational: DEFAULT_SIGNALS.informational,
      transactional: rawCfg.intent_signals_extra?.length
        ? [...DEFAULT_SIGNALS.transactional, ...rawCfg.intent_signals_extra]
        : DEFAULT_SIGNALS.transactional,
      brandTerms: rawCfg.brand_terms ?? DEFAULT_SIGNALS.brandTerms,
    }
    // One SQL pass: aggregate (query_norm, page) across the window
    const rows = await sql<RawMemberRow[]>`
      SELECT
        query_norm,
        page,
        page_type,
        SUM(clicks)::int                                              AS total_clicks,
        SUM(impressions)::int                                         AS total_impressions,
        SUM(position * impressions) / NULLIF(SUM(impressions), 0)    AS weighted_position
      FROM gsc_metric
      WHERE project_id = ${projectId}
        AND date BETWEEN ${windowStart}::date AND ${windowEnd}::date
      GROUP BY query_norm, page, page_type
    `

    // Bucket by query_norm; drop members below impression threshold
    const byQuery = new Map<string, RawMemberRow[]>()
    for (const row of rows) {
      if (row.total_impressions < cfg.min_member_impressions) continue
      const list = byQuery.get(row.query_norm)
      if (list !== undefined) {
        list.push(row)
      } else {
        byQuery.set(row.query_norm, [row])
      }
    }

    // Apply group gates; cap members by impressions
    const candidates: Array<{ queryNorm: string; members: RawMemberRow[] }> = []
    for (const [queryNorm, members] of byQuery) {
      if (members.length < cfg.min_members) continue
      const totalImpr = members.reduce((s, m) => s + m.total_impressions, 0)
      if (totalImpr < cfg.min_group_impressions) continue
      const capped = [...members]
        .sort((a, b) => b.total_impressions - a.total_impressions)
        .slice(0, cfg.max_members)
      candidates.push({ queryNorm, members: capped })
    }

    const seenKeys: string[] = []
    let groupsFound = 0

    for (const { queryNorm, members } of candidates) {
      const key = buildGroupKey(projectId, queryNorm, members.map(m => m.page))

      try {
        const scoringMembers: ScoringMember[] = members.map(m => ({
          page:        m.page,
          pageType:    m.page_type as PageType,
          clicks:      m.total_clicks,
          impressions: m.total_impressions,
          position:    m.weighted_position,
        }))

        const intent       = detectIntent(queryNorm, intentSignals)
        const winner       = pickWinner(scoringMembers)
        const dominant     = pickDominant(scoringMembers, intent)
        const ct           = deriveCannType(scoringMembers)
        const sev          = scoreSeverity(scoringMembers)
        const lost         = scoreLostClicks(scoringMembers)
        const benignResult = scoreBenign(scoringMembers)
        const inversion    = winner.page !== dominant.page

        const byImpr = [...scoringMembers].sort((a, b) => b.impressions - a.impressions)
        const jac = byImpr.length >= 2
          ? pageSlugJaccard(byImpr[0]!.page, byImpr[1]!.page)
          : 0

        const action = recommendedAction({
          cannType:        ct,
          intent,
          winnerPageType:  winner.pageType,
          slugJaccard:     jac,
          benignResult,
        })

        const totalClicks      = members.reduce((s, m) => s + m.total_clicks, 0)
        const totalImpressions = members.reduce((s, m) => s + m.total_impressions, 0)

        await sql.begin(async (tx) => {
          const [grpRow] = await tx<{ id: string }[]>`
            INSERT INTO cannibalization_group (
              project_id, group_key, query_norm, query_intent, cann_type,
              total_clicks, total_impressions, member_count, severity,
              winner_page, dominant_page, inversion, benign, benign_reason,
              recommended_action, lost_clicks, updated_at
            ) VALUES (
              ${projectId}, ${key}, ${queryNorm}, ${intent}, ${ct},
              ${totalClicks}, ${totalImpressions}, ${scoringMembers.length}, ${sev},
              ${winner.page}, ${dominant.page}, ${inversion}, ${benignResult.benign},
              ${benignResult.reason ?? null}, ${action}, ${lost}, now()
            )
            ON CONFLICT (project_id, group_key) DO UPDATE SET
              query_norm         = EXCLUDED.query_norm,
              query_intent       = EXCLUDED.query_intent,
              cann_type          = EXCLUDED.cann_type,
              total_clicks       = EXCLUDED.total_clicks,
              total_impressions  = EXCLUDED.total_impressions,
              member_count       = EXCLUDED.member_count,
              severity           = EXCLUDED.severity,
              winner_page        = EXCLUDED.winner_page,
              dominant_page      = EXCLUDED.dominant_page,
              inversion          = EXCLUDED.inversion,
              benign             = EXCLUDED.benign,
              benign_reason      = EXCLUDED.benign_reason,
              recommended_action = EXCLUDED.recommended_action,
              lost_clicks        = EXCLUDED.lost_clicks,
              updated_at         = now()
            RETURNING id
          `
          if (!grpRow) throw new Error('detect: upsert returned no group id')
          const groupId = grpRow.id

          await tx`DELETE FROM cannibalization_member WHERE group_id = ${groupId}`
          await tx`
            INSERT INTO cannibalization_member
            ${tx(
              scoringMembers.map(m => ({
                group_id:    groupId,
                page:        m.page,
                page_type:   m.pageType,
                clicks:      m.clicks,
                impressions: m.impressions,
                position:    m.position,
                is_winner:   m.page === winner.page,
              })),
              'group_id', 'page', 'page_type', 'clicks', 'impressions', 'position', 'is_winner',
            )}
          `
        })

        seenKeys.push(key)
        groupsFound++
      } catch (err) {
        log.error(reqId, 'detect.group_error', {
          projectId,
          meta: { queryNorm, error: String(err) },
        })
      }
    }

    // Prune groups not produced by this run
    if (seenKeys.length > 0) {
      await sql`
        DELETE FROM cannibalization_group
        WHERE project_id = ${projectId}
          AND NOT (group_key = ANY(${seenKeys}))
      `
    } else {
      await sql`DELETE FROM cannibalization_group WHERE project_id = ${projectId}`
    }

    await sql`
      UPDATE detection_run
      SET status = 'succeeded', groups_found = ${groupsFound}, finished_at = now()
      WHERE id = ${runId}
    `

    log.info(reqId, 'detect.run_succeeded', { projectId, meta: { groupsFound } })
    return { runId, groupsFound }
  } catch (err) {
    await sql`
      UPDATE detection_run SET status = 'failed', finished_at = now() WHERE id = ${runId}
    `.catch(() => undefined)
    throw err
  }
}
