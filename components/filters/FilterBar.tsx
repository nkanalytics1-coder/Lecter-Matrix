'use client'

import { X } from 'lucide-react'
import type { FilterBarProps, GroupFilter } from '@/src/contracts/ui/props'
import { CannType, GroupStatus, Intent, SeverityBand } from '@/src/contracts/types/domain'
import { FacetSelect } from './FacetSelect'
import { PresetChips } from './PresetChips'
import { RangeInput } from './RangeInput'

const SEVERITY_BAND_LABELS: Record<SeverityBand, string> = {
  critical: 'Critico',
  high:     'Alto',
  medium:   'Medio',
  low:      'Basso',
}

const CANN_TYPE_LABELS: Record<CannType, string> = {
  collection_vs_collection: 'Raccolta vs Raccolta',
  collection_vs_blog:       'Raccolta vs Blog',
  blog_vs_blog:             'Blog vs Blog',
  mixed:                    'Misto',
}

const INTENT_LABELS: Record<Intent, string> = {
  informational: 'Informativo',
  transactional: 'Transazionale',
  navigational:  'Navigazionale',
  unknown:       'Non noto',
}

const STATUS_LABELS: Record<GroupStatus, string> = {
  open:        'Aperto',
  in_progress: 'In corso',
  resolved:    'Risolto',
  ignored:     'Ignorato',
}

function countActiveFilters(filter: GroupFilter): number {
  let n = 0
  if (filter.severityBand?.length) n++
  if (filter.severityMin != null) n++
  if (filter.cannType?.length) n++
  if (filter.intent?.length) n++
  if (filter.status?.length) n++
  if (filter.pathPrefix) n++
  if (filter.inversionOnly) n++
  if (filter.hideBenign) n++
  if (filter.q) n++
  return n
}

export function FilterBar({ filter, onChange }: FilterBarProps) {
  const activeCount = countActiveFilters(filter)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PresetChips filter={filter} onChange={onChange} />
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            aria-label="Rimuovi tutti i filtri"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-border"
          >
            <X className="h-3.5 w-3.5" />
            Rimuovi tutti
            <span className="ml-0.5 rounded bg-foreground px-1 py-0.5 text-xs font-semibold text-background">
              {activeCount}
            </span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <FacetSelect
          label="Severità"
          options={SeverityBand}
          value={filter.severityBand ?? null}
          onChange={(v) => onChange({ ...filter, severityBand: v ?? undefined })}
          renderOption={(v) => SEVERITY_BAND_LABELS[v]}
        />
        <FacetSelect
          label="Tipo cann."
          options={CannType}
          value={filter.cannType ?? null}
          onChange={(v) => onChange({ ...filter, cannType: v ?? undefined })}
          renderOption={(v) => CANN_TYPE_LABELS[v]}
        />
        <FacetSelect
          label="Intento"
          options={Intent}
          value={filter.intent ?? null}
          onChange={(v) => onChange({ ...filter, intent: v ?? undefined })}
          renderOption={(v) => INTENT_LABELS[v]}
        />
        <FacetSelect
          label="Stato"
          options={GroupStatus}
          value={filter.status ?? null}
          onChange={(v) => onChange({ ...filter, status: v ?? undefined })}
          renderOption={(v) => STATUS_LABELS[v]}
        />
        <RangeInput
          label="Sev. min"
          value={filter.severityMin ?? null}
          onChange={(v) => onChange({ ...filter, severityMin: v ?? undefined })}
        />
      </div>
    </div>
  )
}
