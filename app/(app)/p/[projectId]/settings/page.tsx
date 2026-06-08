import { requireSession } from '@/server/auth'
import { getProject } from '@/server/repositories/project.repo'
import { SettingsForm } from '@/components/settings/SettingsForm'
import { AnalysisButton } from '@/components/analysis/AnalysisButton'
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

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-medium">Analisi cannibalizzazione</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Avvia una nuova analisi sui dati GSC del progetto. L&apos;operazione viene eseguita in
          background; puoi monitorare lo stato dalla pagina dei gruppi.
        </p>
        <AnalysisButton projectId={projectId} />
      </section>

      <SettingsForm projectId={projectId} initialData={project} />
    </div>
  )
}
