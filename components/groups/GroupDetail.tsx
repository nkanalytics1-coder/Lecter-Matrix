'use client'

import { useQuery } from '@tanstack/react-query'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'
import { apiClient } from '@/lib/api-client'
import { SeverityBadge } from '@/components/cells/SeverityBadge'
import { CannTypeTag } from '@/components/cells/CannTypeTag'
import { ActionTag } from '@/components/cells/ActionTag'
import { MemberCompare } from '@/components/groups/MemberCompare'
import { ActionPanel } from '@/components/groups/ActionPanel'
import { TriagePanel } from '@/components/groups/TriagePanel'

interface Props {
  groupId:     number
  initialData: CannibalizationGroupDTO
}

export function GroupDetail({ groupId, initialData }: Props) {
  const { data: group } = useQuery({
    queryKey: ['group', groupId],
    queryFn:  async () => {
      const result = await apiClient<CannibalizationGroupDTO>(`/api/groups/${groupId}`)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    initialData,
    staleTime: 30_000,
  })

  return (
    <div className="flex flex-col gap-6">
      {group.inversion && (
        <InversionBanner
          winnerPage={group.winnerPage}
          dominantPage={group.dominantPage}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{group.queryNorm}</h1>
        <SeverityBadge band={group.severityBand} score={group.severity} />
        <CannTypeTag type={group.cannType} />
        <ActionTag action={group.recommendedAction} />
      </div>

      {group.members !== undefined && group.members.length > 0 && (
        <MemberCompare
          members={group.members}
          winnerPage={group.winnerPage}
          dominantPage={group.dominantPage}
        />
      )}

      <ActionPanel action={group.recommendedAction} />

      <TriagePanel
        groupId={groupId}
        state={group.state}
        updatedAt={group.updatedAt}
      />
    </div>
  )
}

function InversionBanner({
  winnerPage,
  dominantPage,
}: {
  winnerPage:   string | null
  dominantPage: string | null
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
    >
      <p className="font-semibold">
        Inversione rilevata: la pagina che ranka non è quella che dovrebbe vincere.
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium whitespace-nowrap">In classifica (winner):</dt>
        <dd className="truncate font-mono">{winnerPage ?? '—'}</dd>
        <dt className="font-medium whitespace-nowrap">Dovrebbe vincere (dominant):</dt>
        <dd className="truncate font-mono">{dominantPage ?? '—'}</dd>
      </dl>
    </div>
  )
}
