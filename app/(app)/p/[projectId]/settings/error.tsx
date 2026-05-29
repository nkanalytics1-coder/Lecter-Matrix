'use client'

import type { ReactElement } from 'react'
import { ErrorBand } from '@/components/states/ErrorBand'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function SettingsError({ reset }: Props): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <ErrorBand
        message="Errore durante il caricamento delle impostazioni. Riprova o aggiorna la pagina."
        retry={reset}
      />
    </div>
  )
}
