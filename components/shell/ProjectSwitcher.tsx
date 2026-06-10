'use client'

import { type ReactElement, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'

interface ProjectSwitcherProps {
  currentProjectId: string
}

export function ProjectSwitcher({ currentProjectId }: ProjectSwitcherProps): ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient<ProjectDTO[]>('/api/projects'),
  })

  const projects = query.data?.data ?? []
  const current = projects.find((p) => p.id === currentProjectId)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function handleSelect(id: string) {
    setOpen(false)
    if (id !== currentProjectId) {
      router.push(`/p/${id}/overview`)
    }
  }

  function handleNewProject() {
    setOpen(false)
    router.push('/onboarding')
  }

  const label = query.isLoading ? 'Loading…' : (current?.name ?? 'Select project')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={query.isLoading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch project"
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-border disabled:opacity-50"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-max rounded-md border border-border bg-background py-1 shadow-md"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
        >
          <ul role="listbox" aria-label="Projects">
            {projects.map((p) => (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === currentProjectId}
                tabIndex={0}
                onClick={() => handleSelect(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelect(p.id)
                  }
                }}
                className="cursor-pointer px-3 py-1.5 text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none aria-selected:font-medium"
              >
                {p.name}
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={handleNewProject}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 hover:bg-accent focus:bg-accent focus:outline-none dark:text-green-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuovo progetto
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
