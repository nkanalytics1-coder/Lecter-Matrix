import 'server-only'
import type { CannType, Intent, PageType, RecommendedAction } from '../../src/contracts/types/domain'
import type { BenignResult } from './scoring'

export interface ActionInput {
  cannType: CannType
  intent: Intent
  winnerPageType: PageType
  /** Slug Jaccard between the two primary competing pages */
  slugJaccard: number
  benignResult: BenignResult
}

// Deterministic 8-branch decision table, first-match-wins
export function recommendedAction(input: ActionInput): RecommendedAction {
  const { cannType: ct, intent, winnerPageType, slugJaccard, benignResult } = input
  const isVariant = benignResult.reason === 'base_variant'
  const sameCategoryType = ct === 'collection_vs_collection' || ct === 'blog_vs_blog'

  // 1. Near-duplicate same-type pages → redirect and consolidate
  if (sameCategoryType && slugJaccard >= 0.5 && !isVariant) return 'consolidate_301'

  // 2. Base page vs personalised variant → differentiate on-page
  if (isVariant) return 'differentiate_variant_onpage'

  // 3. Blog ranking for transactional intent → despine blog into collection
  if (ct === 'collection_vs_blog' && intent === 'transactional' && winnerPageType === 'blog') {
    return 'despine_blog_to_collection'
  }

  // 4. Collection + blog competing for informational → reposition collection, strengthen blog
  if (ct === 'collection_vs_blog' && intent === 'informational') {
    return 'reposition_collection_strengthen_blog'
  }

  // 5. Collection winning transactional, blog also competes → interlink blog to collection
  if (ct === 'collection_vs_blog' && intent === 'transactional') {
    return 'interlink_blog_to_collection'
  }

  // 6. Blog vs blog for informational → reduce overlap or canonical
  if (ct === 'blog_vs_blog' && intent === 'informational') return 'reduce_blog_overlap_or_canonical'

  // 7. Blog vs blog for transactional → consolidate blog cluster
  if (ct === 'blog_vs_blog' && intent === 'transactional') return 'consolidate_blog_cluster'

  // 8. Fallback: generic on-page differentiation
  return 'differentiate_onpage'
}
