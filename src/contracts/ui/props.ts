import type { z } from 'zod'
import type {
  CannibalizationGroupDTO,
  GroupMemberDTO,
  OverviewDTO,
} from '../types/entities'
import type { SeverityBand } from '../types/domain'
import type { GroupFilterSchema } from '../schemas/requests'

export type GroupFilter = z.infer<typeof GroupFilterSchema>

export type SortDir = 'asc' | 'desc'
export type SortableField = 'severity' | 'impressions' | 'lostClicks'
export type SortParam = `${SortableField}:${SortDir}`

export interface GroupTableProps {
  data: CannibalizationGroupDTO[]
  sort: SortParam
  onSort: (field: SortableField, dir: SortDir) => void
  onLoadMore: () => void
  hasMore: boolean
}

export interface GroupDetailProps {
  group: CannibalizationGroupDTO
}

export interface MemberCompareProps {
  members: GroupMemberDTO[]
  winnerPage: string | null
  dominantPage: string | null
}

export interface FilterBarProps {
  filter: GroupFilter
  onChange: (filter: GroupFilter) => void
}

export interface SeverityBadgeProps {
  band: SeverityBand
  score: number
}

export interface InversionFlagProps {
  winnerPage: string
  dominantPage: string
}

export interface OverviewProps {
  data: OverviewDTO
}
