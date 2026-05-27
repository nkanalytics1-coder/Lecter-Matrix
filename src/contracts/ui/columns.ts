import type { CannibalizationGroupDTO } from '../types/entities'
import type { SortableField } from './props'

export interface GroupColumn {
  id: string
  header: string
  accessor: keyof CannibalizationGroupDTO
  sortable: boolean
  sortField?: SortableField
  widthHint?: number
  pinLeft?: boolean
}

export const groupColumns: GroupColumn[] = [
  {
    id: 'query',
    header: 'Query',
    accessor: 'queryNorm',
    sortable: false,
    widthHint: 280,
    pinLeft: true,
  },
  {
    id: 'severity',
    header: 'Severity',
    accessor: 'severity',
    sortable: true,
    sortField: 'severity',
    widthHint: 88,
  },
  {
    id: 'severity_band',
    header: 'Band',
    accessor: 'severityBand',
    sortable: false,
    widthHint: 88,
  },
  {
    id: 'cann_type',
    header: 'Type',
    accessor: 'cannType',
    sortable: false,
    widthHint: 180,
  },
  {
    id: 'intent',
    header: 'Intent',
    accessor: 'queryIntent',
    sortable: false,
    widthHint: 120,
  },
  {
    id: 'impressions',
    header: 'Impressions',
    accessor: 'totalImpressions',
    sortable: true,
    sortField: 'impressions',
    widthHint: 112,
  },
  {
    id: 'clicks',
    header: 'Clicks',
    accessor: 'totalClicks',
    sortable: false,
    widthHint: 80,
  },
  {
    id: 'lost_clicks',
    header: 'Lost Clicks',
    accessor: 'lostClicks',
    sortable: true,
    sortField: 'lostClicks',
    widthHint: 100,
  },
  {
    id: 'member_count',
    header: 'Pages',
    accessor: 'memberCount',
    sortable: false,
    widthHint: 72,
  },
  {
    id: 'inversion',
    header: 'Inversion',
    accessor: 'inversion',
    sortable: false,
    widthHint: 88,
  },
  {
    id: 'benign',
    header: 'Benign',
    accessor: 'benign',
    sortable: false,
    widthHint: 72,
  },
  {
    id: 'recommended_action',
    header: 'Action',
    accessor: 'recommendedAction',
    sortable: false,
    widthHint: 240,
  },
  {
    id: 'status',
    header: 'Status',
    accessor: 'state',
    sortable: false,
    widthHint: 100,
  },
]
