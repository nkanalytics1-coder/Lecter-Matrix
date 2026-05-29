'use client'

import type { ReactElement } from 'react'
import { ErrorBand } from '@/components/states/ErrorBand'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function OverviewError({ reset }: Props): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <ErrorBand
        message="Errore durante il caricamento della panoramica. I dati mostrati potrebbero essere obsoleti."
        retry={reset}
      />
    </div>
  )
}
