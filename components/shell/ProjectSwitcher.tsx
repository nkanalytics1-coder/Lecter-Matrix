'use client'

import { type ChangeEvent, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'

interface ProjectSwitcherProps {
  currentProjectId: string
}

export function ProjectSwitcher({ currentProjectId }: ProjectSwitcherProps): ReactElement {
  const router = useRouter()
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient<ProjectDTO[]>('/api/projects'),
  })

  const projects = query.data?.data ?? []

  function handleChange(e: ChangeEvent<HTMLSelectElement>): void {
    const id = e.target.value
    if (id !== currentProjectId) {
      router.push(`/p/${id}/overview`)
    }
  }

  return (
    <select
      value={currentProjectId}
      onChange={handleChange}
      disabled={query.isLoading || projects.length === 0}
      aria-label="Switch project"
      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      {query.isLoading && <option value="">Loading…</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}
