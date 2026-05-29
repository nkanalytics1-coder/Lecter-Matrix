'use client'

import type { ReactElement } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  message: string
  retry?: () => void
}

export function ErrorBand({ message, retry }: Props): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {retry !== undefined && (
        <button
          type="button"
          onClick={retry}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          Riprova
        </button>
      )}
    </div>
  )
}
