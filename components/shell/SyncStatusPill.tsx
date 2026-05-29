'use client'

import type { ReactElement } from 'react'
import type { GscStatus } from '@/src/contracts/types/domain'

interface SyncStatusPillProps {
  status: GscStatus | null
}

function statusDisplay(status: GscStatus | null): { label: string; className: string } {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      }
    case 'pending':
      return {
        label: 'Connecting…',
        className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      }
    case 'revoked':
      return {
        label: 'Revoked',
        className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      }
    case 'disconnected':
    case null:
      return {
        label: 'Disconnected',
        className: 'bg-muted text-muted-foreground',
      }
  }
}

export function SyncStatusPill({ status }: SyncStatusPillProps): ReactElement {
  const { label, className } = statusDisplay(status)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      aria-label={`Connection status: ${label}`}
    >
      {label}
    </span>
  )
}
