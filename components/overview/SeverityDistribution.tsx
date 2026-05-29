'use client'

import { useRouter } from 'next/navigation'
import type { SeverityBand } from '@/src/contracts/types/domain'
import type { OverviewDTO } from '@/src/contracts/types/entities'

interface Props {
  projectId: string
  bandCounts: OverviewDTO['bandCounts']
}

const BANDS: readonly SeverityBand[] = ['critical', 'high', 'medium', 'low']

const BAND_LABEL: Record<SeverityBand, string> = {
  critical: 'Critico',
  high:     'Alto',
  medium:   'Medio',
  low:      'Basso',
}

const BAND_BG: Record<SeverityBand, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-green-400',
}

const BAND_HOVER: Record<SeverityBand, string> = {
  critical: 'hover:bg-red-600',
  high:     'hover:bg-orange-500',
  medium:   'hover:bg-yellow-500',
  low:      'hover:bg-green-500',
}

export function SeverityDistribution({ projectId, bandCounts }: Props) {
  const router = useRouter()

  const totalGroups = BANDS.reduce((s, b) => s + (bandCounts[b]?.groups ?? 0), 0)

  function navigate(band: SeverityBand) {
    router.push(`/p/${projectId}/groups?severityBand=${band}`)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Distribuzione severity</h2>

      {totalGroups === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun gruppo rilevato</p>
      ) : (
        <>
          <div
            className="flex h-6 w-full overflow-hidden rounded"
            role="img"
            aria-label="Barra di distribuzione severity per band"
          >
            {BANDS.map((band) => {
              const count = bandCounts[band]?.groups ?? 0
              if (count === 0) return null
              const pct = (count / totalGroups) * 100
              return (
                <button
                  key={band}
                  type="button"
                  onClick={() => navigate(band)}
                  className={`${BAND_BG[band]} ${BAND_HOVER[band]} cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring`}
                  style={{ width: `${pct}%` }}
                  aria-label={`${BAND_LABEL[band]}: ${count} gruppi — clicca per filtrare`}
                  title={`${BAND_LABEL[band]}: ${count} gruppi`}
                />
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {BANDS.map((band) => {
              const { groups, impressions, lostClicks } = bandCounts[band] ?? { groups: 0, impressions: 0, lostClicks: 0 }
              if (groups === 0) return null
              return (
                <button
                  key={band}
                  type="button"
                  onClick={() => navigate(band)}
                  className="flex items-center gap-1.5 text-left text-xs hover:opacity-75"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${BAND_BG[band]}`} aria-hidden="true" />
                  <span className="font-medium">{BAND_LABEL[band]}</span>
                  <span className="text-muted-foreground">
                    {groups} gruppi · {impressions.toLocaleString('it-IT')} impr · {lostClicks.toLocaleString('it-IT')} click persi
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
