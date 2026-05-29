import type { ReactNode } from 'react'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'
import type { Intent } from '@/src/contracts/types/domain'
import type { DataTableColumn } from './Cell'
import { SeverityBadge } from '../cells/SeverityBadge'

const INTENT_LABELS: Record<Intent, string> = {
  informational: 'Informativo',
  transactional: 'Transazionale',
  navigational:  'Navigazionale',
  unknown:       'Non noto',
}

function renderPage(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>
  }
  const url = value as string
  const path = url.replace(/^https?:\/\/[^/]+/, '') || '/'
  const display = path.length > 40 ? `${path.slice(0, 40)}…` : path
  return (
    <span className="font-mono text-xs truncate" title={url}>
      {display}
    </span>
  )
}

export const groupTableColumns: DataTableColumn<CannibalizationGroupDTO>[] = [
  {
    id:        'query',
    header:    'Query',
    accessor:  'queryNorm',
    sortable:  false,
    widthHint: 280,
    pinLeft:   true,
  },
  {
    id:        'severity',
    header:    'Severità',
    accessor:  'severity',
    sortable:  true,
    sortField: 'severity',
    widthHint: 100,
    renderCell: (_value, row) => (
      <SeverityBadge score={row.severity} band={row.severityBand} />
    ),
  },
  {
    id:        'cann_type',
    header:    'Tipo',
    accessor:  'cannType',
    sortable:  false,
    widthHint: 180,
    render:    'cann-type',
  },
  {
    id:        'intent',
    header:    'Intento',
    accessor:  'queryIntent',
    sortable:  false,
    widthHint: 120,
    renderCell: (value) =>
      value == null
        ? <span className="text-muted-foreground">—</span>
        : <span className="text-sm">{INTENT_LABELS[value as Intent]}</span>,
  },
  {
    id:        'impressions',
    header:    'Impression',
    accessor:  'totalImpressions',
    sortable:  true,
    sortField: 'impressions',
    widthHint: 112,
    render:    'metric',
  },
  {
    id:        'clicks',
    header:    'Click',
    accessor:  'totalClicks',
    sortable:  false,
    widthHint: 80,
    render:    'metric',
  },
  {
    id:        'lost_clicks',
    header:    'Click Persi',
    accessor:  'lostClicks',
    sortable:  true,
    sortField: 'lostClicks',
    widthHint: 100,
    render:    'metric',
  },
  {
    id:        'winner_page',
    header:    'Vincitore',
    accessor:  'winnerPage',
    sortable:  false,
    widthHint: 200,
    renderCell: renderPage,
  },
  {
    id:        'dominant_page',
    header:    'Dominante',
    accessor:  'dominantPage',
    sortable:  false,
    widthHint: 200,
    renderCell: renderPage,
  },
  {
    id:        'inversion',
    header:    'Inversione',
    accessor:  'inversion',
    sortable:  false,
    widthHint: 96,
    render:    'inversion',
  },
  {
    id:        'benign',
    header:    'Benigno',
    accessor:  'benign',
    sortable:  false,
    widthHint: 80,
    renderCell: (value) =>
      value === true
        ? <span className="text-xs font-medium text-green-700 dark:text-green-400">✓</span>
        : <span className="text-muted-foreground select-none">—</span>,
  },
  {
    id:        'recommended_action',
    header:    'Azione',
    accessor:  'recommendedAction',
    sortable:  false,
    widthHint: 200,
    render:    'action',
  },
  {
    id:        'status',
    header:    'Stato',
    accessor:  'state',
    sortable:  false,
    widthHint: 100,
    render:    'status',
  },
  {
    id:        'updated_at',
    header:    'Aggiornato',
    accessor:  'updatedAt',
    sortable:  false,
    widthHint: 100,
    renderCell: (value) => {
      if (value == null) return <span className="text-muted-foreground">—</span>
      const d = new Date(value as string)
      return (
        <span className="text-xs text-muted-foreground">
          {d.toLocaleDateString('it-IT')}
        </span>
      )
    },
  },
]
