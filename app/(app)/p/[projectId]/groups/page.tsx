import { requireSession } from '@/server/auth'
import { listGroups } from '@/server/repositories/group.repo'
import { GroupListQuerySchema } from '@/src/contracts/schemas/requests'
import { GroupTable } from '@/components/groups/GroupTable'
import { AnalysisStatusBadge } from '@/components/analysis/AnalysisStatusBadge'

type PageProps = {
  params:       Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function GroupsPage({ params, searchParams }: PageProps) {
  await requireSession()

  const { projectId } = await params
  const rawSp = await searchParams

  const parseResult = GroupListQuerySchema.safeParse(rawSp)
  const query = parseResult.success ? parseResult.data : GroupListQuerySchema.parse({})

  const firstPage = await listGroups(projectId, query)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Gruppi di cannibalizzazione</h1>
        <AnalysisStatusBadge projectId={projectId} />
      </div>
      <GroupTable projectId={projectId} initialData={firstPage} />
    </div>
  )
}
