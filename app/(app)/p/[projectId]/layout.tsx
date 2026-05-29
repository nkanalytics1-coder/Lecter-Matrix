'use client'

import {
  createContext,
  useContext,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'
import { ProjectSwitcher } from '@/components/shell/ProjectSwitcher'
import { SyncStatusPill } from '@/components/shell/SyncStatusPill'
import { useTopBarSlot } from '@/components/shell/TopBarSlotContext'

// ── ProjectContext ─────────────────────────────────────────────────────────────

const ProjectContext = createContext<ProjectDTO | null>(null)

export function useProject(): ProjectDTO {
  const ctx = useContext(ProjectContext)
  if (ctx === null) {
    throw new Error('useProject must be used within a project layout')
  }
  return ctx
}

// ── TopBar slot injector ───────────────────────────────────────────────────────

function ProjectTopBarSlot({ project }: { project: ProjectDTO }): null {
  const { setSlot } = useTopBarSlot()
  const connectionStatus = project.connection?.status ?? null

  useEffect(() => {
    setSlot(
      <>
        <ProjectSwitcher currentProjectId={project.id} />
        <SyncStatusPill status={connectionStatus} />
      </>,
    )
    return () => {
      setSlot(null)
    }
  }, [project.id, connectionStatus, setSlot])

  return null
}

// ── Layout ─────────────────────────────────────────────────────────────────────

export default function ProjectLayout({
  children,
}: {
  children: ReactNode
}): ReactElement {
  const params = useParams()
  const rawId = params['projectId']
  const projectId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '')

  const query = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient<ProjectDTO>(`/api/projects/${projectId}`),
    enabled: projectId !== '',
  })

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (query.isError) {
    return <p className="text-sm text-destructive">Failed to load project.</p>
  }

  const result = query.data
  if (result === undefined) {
    return <p className="text-sm text-destructive">Project not found.</p>
  }
  if (result.error !== null) {
    return <p className="text-sm text-destructive">{result.error.message}</p>
  }

  const project = result.data

  return (
    <ProjectContext.Provider value={project}>
      <ProjectTopBarSlot project={project} />
      {children}
    </ProjectContext.Provider>
  )
}
