'use client'

import type { GroupFilter } from '@/src/contracts/ui/props'
import type { GroupStatus, SeverityBand } from '@/src/contracts/types/domain'

interface Preset {
  id: string
  label: string
  apply: (current: GroupFilter) => GroupFilter
  isActive: (current: GroupFilter) => boolean
}

const CRITICAL_BAND: SeverityBand[] = ['critical']
const OPEN_STATUS: GroupStatus[] = ['open']

const PRESETS: Preset[] = [
  {
    id: 'critical-inversions',
    label: 'Inversioni critiche',
    apply: (f) => ({ ...f, severityBand: CRITICAL_BAND, inversionOnly: true }),
    isActive: (f) => f.severityBand?.includes('critical') === true && f.inversionOnly === true,
  },
  {
    id: 'quick-wins',
    label: 'Quick wins',
    apply: (f) => ({ ...f, severityMin: 50, hideBenign: true, status: OPEN_STATUS }),
    isActive: (f) =>
      f.severityMin === 50 && f.hideBenign === true && f.status?.includes('open') === true,
  },
  {
    id: 'unresolved',
    label: 'Non risolti',
    apply: (f) => ({ ...f, status: OPEN_STATUS }),
    isActive: (f) => f.status?.includes('open') === true,
  },
  {
    id: 'hide-benign',
    label: 'Nascondi benigni',
    apply: (f) => ({ ...f, hideBenign: true }),
    isActive: (f) => f.hideBenign === true,
  },
]

interface PresetChipsProps {
  filter: GroupFilter
  onChange: (filter: GroupFilter) => void
}

export function PresetChips({ filter, onChange }: PresetChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset filtri">
      {PRESETS.map((preset) => {
        const active = preset.isActive(filter)
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(preset.apply(filter))}
            className={[
              'rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-border',
              active
                ? 'bg-foreground text-background'
                : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
            ].join(' ')}
          >
            {preset.label}
          </button>
        )
      })}
    </div>
  )
}
