import type { RecommendedAction } from '@/src/contracts/types/domain'

interface ActionTagProps {
  action: RecommendedAction
}

const LABELS: Record<RecommendedAction, string> = {
  consolidate_301:                      'Consolida con 301',
  differentiate_variant_onpage:         'Differenzia variante on-page',
  despine_blog_to_collection:           'Distacca blog verso raccolta',
  reposition_collection_strengthen_blog:'Riposiziona raccolta, rafforza blog',
  interlink_blog_to_collection:         'Collega blog a raccolta',
  reduce_blog_overlap_or_canonical:     'Riduci sovrapposizione o canonicalizza',
  consolidate_blog_cluster:             'Consolida cluster blog',
  differentiate_onpage:                 'Differenzia on-page',
}

export function ActionTag({ action }: ActionTagProps) {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-accent text-accent-foreground max-w-xs truncate">
      {LABELS[action]}
    </span>
  )
}
