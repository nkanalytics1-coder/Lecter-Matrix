import type { GroupStatus } from '@/src/contracts/types/domain'

interface StatusPillProps {
  status: GroupStatus | null
}

const LABELS: Record<GroupStatus, string> = {
  open:        'Aperto',
  in_progress: 'In corso',
  resolved:    'Risolto',
  ignored:     'Ignorato',
}

const CLASSES: Record<GroupStatus, string> = {
  open:        'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  resolved:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  ignored:     'bg-accent text-muted-foreground',
}

export function StatusPill({ status }: StatusPillProps) {
  if (status === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
