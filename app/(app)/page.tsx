'use client'

import type { ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'

export default function ProjectsPage(): ReactElement {
  const router = useRouter()
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient<ProjectDTO[]>('/api/projects'),
  })

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return <p className="text-sm text-destructive">Failed to load projects.</p>
  }

  const result = query.data
  if (result === undefined) {
    return <p className="text-sm text-destructive">Failed to load projects.</p>
  }
  if (result.error !== null) {
    return <p className="text-sm text-destructive">{result.error.message}</p>
  }

  const projects = result.data

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects yet. Create one to get started.
      </p>
    )
  }

  return (
    <ul className="space-y-2" role="list">
      {projects.map((project) => (
        <li key={project.id}>
          <button
            type="button"
            onClick={() => { router.push(`/p/${project.id}/overview`) }}
            className="w-full rounded-lg border border-border bg-card px-4 py-4 text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <p className="text-sm font-medium text-foreground">{project.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{project.gscProperty}</p>
          </button>
        </li>
      ))}
    </ul>
  )
}
