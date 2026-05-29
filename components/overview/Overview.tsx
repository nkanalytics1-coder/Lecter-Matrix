'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { OverviewDTO } from '@/src/contracts/types/entities'
import type { ApiResult } from '@/src/contracts/types/api'
import type { RunStatus } from '@/src/contracts/types/domain'
import { SeverityDistribution } from './SeverityDistribution'
import { SyncStatusPill } from '@/components/shell/SyncStatusPill'

interface Props {
  projectId: string
  initialData: OverviewDTO
}

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running:   'In corso',
  succeeded: 'Completato',
  failed:    'Fallito',
}

const RUN_STATUS_CLASS: Record<RunStatus, string> = {
  running:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  failed:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function fmtDate(iso: string | null): string {
  if (iso === null) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString('it-IT')}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

export function Overview({ projectId, initialData }: Props) {
  const { data } = useQuery<ApiResult<OverviewDTO>>({
    queryKey:    ['overview', projectId],
    queryFn:     () => apiClient<OverviewDTO>(`/api/projects/${projectId}/overview`),
    initialData: { data: initialData, error: null },
  })

  const overview = data.data ?? initialData
  const bands    = overview.bandCounts
  const lastRun  = overview.lastRun
  const sync     = overview.sync

  const totalGroups      = (['critical', 'high', 'medium', 'low'] as const).reduce((s, b) => s + (bands[b]?.groups ?? 0), 0)
  const totalImpressions = (['critical', 'high', 'medium', 'low'] as const).reduce((s, b) => s + (bands[b]?.impressions ?? 0), 0)
  const totalLostClicks  = (['critical', 'high', 'medium', 'low'] as const).reduce((s, b) => s + (bands[b]?.lostClicks ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Panoramica</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Gruppi totali"         value={totalGroups} />
        <MetricCard label="Impressioni totali"     value={totalImpressions} />
        <MetricCard label="Click persi stimati"    value={totalLostClicks} />
      </div>

      <SeverityDistribution projectId={projectId} bandCounts={bands} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Ultima analisi</h2>
          {lastRun === null || lastRun === undefined ? (
            <p className="text-sm text-muted-foreground">Nessuna analisi eseguita</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${RUN_STATUS_CLASS[lastRun.status]}`}>
                  {RUN_STATUS_LABEL[lastRun.status]}
                </span>
                {lastRun.groupsFound !== null && (
                  <span className="tabular-nums text-muted-foreground">
                    {lastRun.groupsFound} gruppi trovati
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">Avviata: {fmtDate(lastRun.startedAt)}</span>
              {lastRun.finishedAt !== null && (
                <span className="text-xs text-muted-foreground">Terminata: {fmtDate(lastRun.finishedAt)}</span>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Connessione GSC</h2>
          <div className="flex flex-col gap-2">
            <SyncStatusPill status={sync.status} />
            <span className="text-xs text-muted-foreground">
              Ultima sincronizzazione:{' '}
              {sync.lastSyncedDate !== null
                ? new Date(sync.lastSyncedDate).toLocaleDateString('it-IT')
                : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
