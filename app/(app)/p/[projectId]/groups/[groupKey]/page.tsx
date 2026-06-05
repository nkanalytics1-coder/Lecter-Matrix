import { notFound } from 'next/navigation'
import { requireSession } from '@/server/auth'
import { getGroupDrill } from '@/server/repositories/group.repo'
import { GroupDetail } from '@/components/groups/GroupDetail'

type PageProps = {
  params: Promise<{ projectId: string; groupKey: string }>
}

export default async function GroupDrillPage({ params }: PageProps) {
  await requireSession()

  const { projectId, groupKey } = await params
  if (groupKey === '') notFound()

  const group = await getGroupDrill(projectId, groupKey)
  if (group === null) notFound()

  return (
    <div className="flex flex-col gap-6">
      <GroupDetail projectId={projectId} groupKey={groupKey} initialData={group} />
    </div>
  )
}
