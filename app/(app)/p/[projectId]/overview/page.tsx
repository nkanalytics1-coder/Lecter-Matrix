import { requireSession } from '@/server/auth'
import { getOverview } from '@/server/repositories/misc.repo'
import { Overview } from '@/components/overview/Overview'

type PageProps = { params: Promise<{ projectId: string }> }

export default async function OverviewPage({ params }: PageProps) {
  await requireSession()
  const { projectId } = await params
  const initialData = await getOverview(projectId)
  return <Overview projectId={projectId} initialData={initialData} />
}
