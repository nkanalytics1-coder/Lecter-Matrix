import { notFound } from 'next/navigation'
import { requireSession } from '@/server/auth'
import { getGroupDrill } from '@/server/repositories/group.repo'
import { GroupDetail } from '@/components/groups/GroupDetail'

type PageProps = {
  params: Promise<{ projectId: string; groupId: string }>
}

export default async function GroupDrillPage({ params }: PageProps) {
  await requireSession()

  const { groupId: rawId } = await params
  const groupId = parseInt(rawId, 10)
  if (isNaN(groupId)) notFound()

  const group = await getGroupDrill(groupId)
  if (group === null) notFound()

  return (
    <div className="flex flex-col gap-6">
      <GroupDetail groupId={groupId} initialData={group} />
    </div>
  )
}
