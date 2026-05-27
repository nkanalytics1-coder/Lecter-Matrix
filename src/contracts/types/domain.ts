export const PageType = ['collection', 'blog', 'product', 'other', 'unknown'] as const
export type PageType = (typeof PageType)[number]

export const Intent = ['informational', 'transactional', 'navigational', 'unknown'] as const
export type Intent = (typeof Intent)[number]

export const CannType = [
  'collection_vs_collection',
  'collection_vs_blog',
  'blog_vs_blog',
  'mixed',
] as const
export type CannType = (typeof CannType)[number]

export const RecommendedAction = [
  'consolidate_301',
  'differentiate_variant_onpage',
  'despine_blog_to_collection',
  'reposition_collection_strengthen_blog',
  'interlink_blog_to_collection',
  'reduce_blog_overlap_or_canonical',
  'consolidate_blog_cluster',
  'differentiate_onpage',
] as const
export type RecommendedAction = (typeof RecommendedAction)[number]

export const GroupStatus = ['open', 'in_progress', 'resolved', 'ignored'] as const
export type GroupStatus = (typeof GroupStatus)[number]

export const SeverityBand = ['critical', 'high', 'medium', 'low'] as const
export type SeverityBand = (typeof SeverityBand)[number]

export const BenignReason = ['base_variant', 'mother_child'] as const
export type BenignReason = (typeof BenignReason)[number]

export const ProjectStatus = ['active', 'paused', 'error'] as const
export type ProjectStatus = (typeof ProjectStatus)[number]

export const GscStatus = ['connected', 'revoked', 'error'] as const
export type GscStatus = (typeof GscStatus)[number]

export const RunStatus = ['running', 'succeeded', 'failed'] as const
export type RunStatus = (typeof RunStatus)[number]

export const PropertyType = ['domain', 'url_prefix'] as const
export type PropertyType = (typeof PropertyType)[number]

