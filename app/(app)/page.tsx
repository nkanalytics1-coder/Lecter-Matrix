import type { ReactElement } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireSession } from '@/server/auth'
import { listProjects } from '@/server/repositories/project.repo'

export default async function ProjectsPage(): Promise<ReactElement> {
  try {
    await requireSession()
  } catch {
    redirect('/login')
  }

  let projects
  try {
    projects = await listProjects()
  } catch (err) {
    console.error('listProjects failed:', err)
    return <p className="text-sm text-destructive">Impossibile caricare i progetti: {String(err)}</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/onboarding"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Crea nuovo progetto
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun progetto ancora. Creane uno per iniziare.
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/p/${project.id}/overview`}
                className="block w-full rounded-lg border border-border bg-card px-4 py-4 text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <p className="text-sm font-medium text-foreground">{project.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{project.gscProperty}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}