import type { SeverityBand } from '@/src/contracts/types/domain'

interface SeverityBadgeProps {
  band: SeverityBand
  score: number
}

const BAND_CLASSES: Record<SeverityBand, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  low:      'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
}

export function SeverityBadge({ band, score }: SeverityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tabular-nums ${BAND_CLASSES[band]}`}
    >
      {score.toFixed(1)}
    </span>
  )
}
