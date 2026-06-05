import type {
  CannType,
  GscStatus,
  GroupStatus,
  Intent,
  PageType,
  ProjectStatus,
  PropertyType,
  RecommendedAction,
  RunStatus,
  SeverityBand,
} from './domain'

export interface GroupMemberDTO {
  page: string
  pageType: PageType
  clicks: number
  impressions: number
  position: number
  isWinner: boolean
}

export interface CannibalizationGroupDTO {
  id: string
  groupKey: string
  queryNorm: string
  queryIntent: Intent
  searchVolume: number | null
  cannType: CannType
  totalClicks: number
  totalImpressions: number
  memberCount: number
  severity: number
  severityBand: SeverityBand
  winnerPage: string | null
  dominantPage: string | null
  inversion: boolean
  benign: boolean
  benignReason: string | null
  recommendedAction: RecommendedAction
  lostClicks: number
  state: { status: GroupStatus; notes: string | null } | null
  members?: GroupMemberDTO[]
  updatedAt: string
}

export interface ProjectDTO {
  id: string
  name: string
  gscProperty: string
  propertyType: PropertyType
  timezone: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  connection?: { status: GscStatus; lastSyncedDate: string | null }
  lastRun?: {
    id: number
    status: RunStatus
    groupsFound: number | null
    startedAt: string
    finishedAt: string | null
  } | null
}

export interface OverviewDTO {
  bandCounts: Record<SeverityBand, { groups: number; impressions: number; lostClicks: number }>
  lastRun: ProjectDTO['lastRun']
  sync: { lastSyncedDate: string | null; status: GscStatus }
}

