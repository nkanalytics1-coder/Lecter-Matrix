'use client'

import type { ReactElement } from 'react'
import { ErrorBand } from '@/components/states/ErrorBand'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GroupsError({ reset }: Props): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <ErrorBand
        message="Errore durante il caricamento dei gruppi. I dati mostrati potrebbero essere obsoleti."
        retry={reset}
      />
    </div>
  )
}
