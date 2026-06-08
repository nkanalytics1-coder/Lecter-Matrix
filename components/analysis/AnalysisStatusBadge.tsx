'use client'

import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { AnalysisRunDTO } from '@/src/contracts/types/api'

interface Props {
  projectId: string
}

function isRecent(completedAt: string | null): boolean {
  if (!completedAt) return false
  return Date.now() - new Date(completedAt).getTime() < 60 * 60 * 1000
}

export function AnalysisStatusBadge({ projectId }: Props): ReactElement | null {
  const { data: run } = useQuery({
    queryKey: ['analysis-status', projectId],
    queryFn: async () => {
      const result = await apiClient<AnalysisRunDTO>(
        `/api/projects/${projectId}/analysis/status`,
      )
      if (result.error) {
        if (result.error.code === 'not_found') return null
        throw new Error(result.error.message)
      }
      return result.data
    },
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.status === 'queued' || data.status === 'running' ? 5_000 : false
    },
    staleTime: 10_000,
  })

  if (!run) return null
  if (run.status === 'completed' && !isRecent(run.completedAt)) return null
  if (run.status === 'failed' && !isRecent(run.completedAt)) return null

  const config: Record<string, { label: string; className: string; pulse: boolean }> = {
    queued: {
      label: 'In coda',
      className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      pulse: false,
    },
    running: {
      label: run.progressStep ?? 'In esecuzione…',
      className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
      pulse: true,
    },
    completed: {
      label: 'Analisi completata',
      className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      pulse: false,
    },
    failed: {
      label: 'Analisi fallita',
      className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      pulse: false,
    },
  }

  const { label, className, pulse } = config[run.status] ?? config['failed']!

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      aria-live="polite"
    >
      {pulse && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      )}
      {label}
    </span>
  )
}
