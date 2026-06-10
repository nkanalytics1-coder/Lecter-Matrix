'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { AnalysisRunDTO } from '@/src/contracts/types/api'

interface Props {
  projectId: string
}

interface Notification {
  type: 'success' | 'error'
  message: string
}

export function AnalysisButton({ projectId }: Props): ReactElement {
  const queryClient = useQueryClient()
  const [notification, setNotification] = useState<Notification | null>(null)
  const [triggering, setTriggering] = useState(false)
  const prevStatusRef = useRef<string>('init')

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

  // Detect completed/failed transitions to show inline notification and refresh groups
  const runStatus = run?.status
  const runError = run?.error
  useEffect(() => {
    if (runStatus === undefined) return

    const prev = prevStatusRef.current
    if (prev === runStatus) return
    prevStatusRef.current = runStatus

    if (prev === 'init') return // first data arrival — no notification

    if (runStatus === 'completed') {
      void Promise.resolve().then(() => setNotification({
        type: 'success',
        message: 'Analisi completata. La tabella dei gruppi è stata aggiornata.',
      }))
      void queryClient.invalidateQueries({ queryKey: ['groups', projectId] })
    } else if (runStatus === 'failed') {
      void Promise.resolve().then(() => setNotification({
        type: 'error',
        message: runError ?? 'Analisi fallita.',
      }))
    }
  }, [runStatus, runError, queryClient, projectId])

  const handleTrigger = useCallback(async () => {
    setTriggering(true)
    setNotification(null)
    try {
      const result = await apiClient<{ runId: string }>(
        `/api/projects/${projectId}/analysis`,
        { method: 'POST' },
      )
      if (result.error) {
        setNotification({
          type: 'error',
          message:
            result.error.code === 'conflict'
              ? "Un'analisi è già in corso."
              : result.error.message,
        })
      } else {
        // Seed the prev-status ref so the transition effect fires correctly
        prevStatusRef.current = 'queued'
        void queryClient.invalidateQueries({ queryKey: ['analysis-status', projectId] })
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Errore di rete.',
      })
    } finally {
      setTriggering(false)
    }
  }, [projectId, queryClient])

  const isActive = run?.status === 'queued' || run?.status === 'running'
  const isDisabled = isActive || triggering

  const buttonConfig = ((): { label: string; className: string } => {
    if (triggering) {
      return { label: 'Avvio…', className: 'bg-gray-400 text-white cursor-not-allowed' }
    }
    if (run?.status === 'queued') {
      return { label: 'In coda…', className: 'bg-yellow-500 text-white cursor-not-allowed' }
    }
    if (run?.status === 'running') {
      return {
        label: run.progressStep ? `${run.progressStep}…` : 'Analisi in corso…',
        className: 'animate-pulse bg-sky-500 text-white cursor-not-allowed',
      }
    }
    return {
      label: 'Esegui analisi',
      className: 'bg-green-600 text-white hover:bg-green-700 cursor-pointer',
    }
  })()

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => { void handleTrigger() }}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${buttonConfig.className}`}
      >
        {buttonConfig.label}
      </button>

      <p className="mt-1 text-sm text-gray-500">L&apos;analisi può richiedere diverse ore.</p>

      {notification && (
        <div
          role="alert"
          aria-live="assertive"
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
            notification.type === 'success'
              ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}
        >
          <span className="flex-1">{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Chiudi notifica"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
