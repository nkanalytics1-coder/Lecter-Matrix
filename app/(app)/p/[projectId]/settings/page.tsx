import { requireSession } from '@/server/auth'
import { getProject } from '@/server/repositories/project.repo'
import { SettingsForm } from '@/components/settings/SettingsForm'
import { notFound } from 'next/navigation'

type PageProps = { params: Promise<{ projectId: string }> }

export default async function SettingsPage({ params }: PageProps) {
  await requireSession()
  const { projectId } = await params
  const project = await getProject(projectId)
  if (project === null) notFound()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Impostazioni progetto</h1>
      <SettingsForm projectId={projectId} initialData={project} />
    </div>
  )
}
