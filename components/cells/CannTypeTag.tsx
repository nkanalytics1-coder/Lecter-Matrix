import type { CannType } from '@/src/contracts/types/domain'

interface CannTypeTagProps {
  type: CannType
}

const LABELS: Record<CannType, string> = {
  collection_vs_collection: 'Raccolta vs Raccolta',
  collection_vs_blog:       'Raccolta vs Blog',
  blog_vs_blog:             'Blog vs Blog',
  mixed:                    'Misto',
}

export function CannTypeTag({ type }: CannTypeTagProps) {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-accent text-accent-foreground">
      {LABELS[type]}
    </span>
  )
}
