import 'server-only'
import type { CannType, Intent, PageType, BenignReason } from '../../src/contracts/types/domain'
import { slugTokens, isPersonalized } from '../ingest/normalize'

export interface ScoringMember {
  page: string
  pageType: PageType
  clicks: number
  impressions: number
  position: number
}

export interface BenignResult {
  benign: boolean
  reason: BenignReason | null
}

// Intent × PageType prior: likelihood the page type is the correct winner for the intent
const PRIOR: Record<Intent, Record<PageType, number>> = {
  informational: { blog: 0.9, collection: 0.3, product: 0.2, other: 0.1, unknown: 0.2 },
  transactional: { collection: 0.9, product: 0.7, blog: 0.1, other: 0.1, unknown: 0.2 },
  navigational:  { collection: 0.6, product: 0.5, blog: 0.3, other: 0.4, unknown: 0.3 },
  unknown:       { collection: 0.5, product: 0.4, blog: 0.4, other: 0.2, unknown: 0.3 },
}

// Organic CTR benchmark by position 1–10 (positions >10 clamped to 10)
const CTR_AT: Record<number, number> = {
  1: 0.284, 2: 0.152, 3: 0.102, 4: 0.073, 5: 0.053,
  6: 0.040, 7: 0.031, 8: 0.025, 9: 0.020, 10: 0.016,
}

function ctrBenchmark(position: number): number {
  const p = Math.max(1, Math.min(position, 10))
  const lo = Math.floor(p)
  const hi = Math.ceil(p)
  const ctrLo = CTR_AT[lo] ?? 0.016
  if (lo === hi) return ctrLo
  const ctrHi = CTR_AT[hi] ?? 0.016
  return ctrLo + (ctrHi - ctrLo) * (p - lo)
}

function minMaxNorm(values: readonly number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0.5)
  return values.map(v => (v - min) / (max - min))
}

function jaccardSlugs(a: string, b: string): number {
  const sa = new Set(slugTokens(a))
  const sb = new Set(slugTokens(b))
  const intersection = [...sa].filter(t => sb.has(t)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 1 : intersection / union
}

// Winner = member with most clicks; tiebreak: most impressions
export function pickWinner(members: readonly ScoringMember[]): ScoringMember {
  if (members.length === 0) throw new Error('pickWinner: empty members')
  let best = members[0]!
  for (const m of members) {
    if (m.clicks > best.clicks || (m.clicks === best.clicks && m.impressions > best.impressions)) {
      best = m
    }
  }
  return best
}

// Derive cannibalization type from the set of page types in the group
export function cannType(members: readonly ScoringMember[]): CannType {
  const types = new Set(members.map(m => m.pageType))
  if (types.size === 1 && types.has('collection')) return 'collection_vs_collection'
  if (types.size === 1 && types.has('blog')) return 'blog_vs_blog'
  if (types.has('collection') && types.has('blog') && [...types].every(t => t === 'collection' || t === 'blog')) {
    return 'collection_vs_blog'
  }
  return 'mixed'
}

// Dominant = page that SHOULD rank. Score: 0.55·norm(clicks) + 0.30·norm(1/pos) + 0.15·prior
// Min-max normalised within group. Tiebreak: lexicographically lower page string.
export function pickDominant(members: readonly ScoringMember[], intent: Intent): ScoringMember {
  if (members.length === 0) throw new Error('pickDominant: empty members')
  const clicksNorm = minMaxNorm(members.map(m => m.clicks))
  const posInvNorm = minMaxNorm(members.map(m => 1 / Math.max(m.position, 0.1)))

  const scores = members.map((m, i) => {
    const prior = PRIOR[intent][m.pageType]
    return 0.55 * (clicksNorm[i] ?? 0.5) + 0.30 * (posInvNorm[i] ?? 0.5) + 0.15 * prior
  })

  let bestIdx = 0
  for (let i = 1; i < scores.length; i++) {
    const s = scores[i] ?? 0
    const bs = scores[bestIdx] ?? 0
    if (s > bs || (s === bs && (members[i]?.page ?? '') < (members[bestIdx]?.page ?? ''))) {
      bestIdx = i
    }
  }
  return members[bestIdx]!
}

// Severity ∈ [0,100]: 100·(0.40·V + 0.35·S + 0.25·P)
// V = volume (log-scale impressions), S = split evenness, P = position spread
export function severity(members: readonly ScoringMember[]): number {
  if (members.length === 0) return 0
  const totalImpr = members.reduce((s, m) => s + m.impressions, 0)
  const maxImpr = Math.max(...members.map(m => m.impressions))
  const avgPos = members.reduce((s, m) => s + m.position, 0) / members.length
  const bestPos = Math.min(...members.map(m => m.position))

  const V = Math.min(Math.log10(1 + totalImpr) / Math.log10(1 + 100_000), 1)
  const S = totalImpr === 0 ? 0 : 1 - maxImpr / totalImpr
  const P = Math.min(Math.max((avgPos - bestPos) / 10, 0), 1)

  return Math.min(Math.max(100 * (0.40 * V + 0.35 * S + 0.25 * P), 0), 100)
}

// Opportunity: clicks left on the table if all impressions converted at the best-position CTR
export function lostClicks(members: readonly ScoringMember[]): number {
  if (members.length === 0) return 0
  const totalClicks = members.reduce((s, m) => s + m.clicks, 0)
  const totalImpr = members.reduce((s, m) => s + m.impressions, 0)
  const bestPos = Math.min(...members.map(m => m.position))
  return Math.max(0, Math.round(totalImpr * ctrBenchmark(bestPos) - totalClicks))
}

// Benign detection:
//   base_variant — exactly one of top-2 by impressions is personalised, slug Jaccard ≥ 0.5
//   mother_child — slug tokens of the shorter URL are a proper subset of the longer URL's tokens
export function benign(members: readonly ScoringMember[]): BenignResult {
  if (members.length < 2) return { benign: false, reason: null }
  const sorted = [...members].sort((a, b) => b.impressions - a.impressions)
  const a = sorted[0]!
  const b = sorted[1]!

  const aP = isPersonalized(a.page)
  const bP = isPersonalized(b.page)
  if (aP !== bP && jaccardSlugs(a.page, b.page) >= 0.5) {
    return { benign: true, reason: 'base_variant' }
  }

  const setA = new Set(slugTokens(a.page))
  const setB = new Set(slugTokens(b.page))
  if (setA.size > 0 && setB.size > 0 && setA.size !== setB.size) {
    const [smaller, larger] = setA.size < setB.size ? [setA, setB] : [setB, setA]
    if ([...smaller].every(t => (larger as Set<string>).has(t))) {
      return { benign: true, reason: 'mother_child' }
    }
  }

  return { benign: false, reason: null }
}
