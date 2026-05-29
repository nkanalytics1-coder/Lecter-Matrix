import type { ReactNode } from 'react'
import type { SortableField } from '@/src/contracts/ui/props'
import type { CannType, GroupStatus, RecommendedAction } from '@/src/contracts/types/domain'
import { MetricCell } from '../cells/MetricCell'
import { InversionFlag } from '../cells/InversionFlag'
import { CannTypeTag } from '../cells/CannTypeTag'
import { StatusPill } from '../cells/StatusPill'
import { ActionTag } from '../cells/ActionTag'

export type RenderIntent = 'metric' | 'inversion' | 'cann-type' | 'status' | 'action'

export interface DataTableColumn<Row> {
  id: string
  header: string
  accessor: Extract<keyof Row, string>
  sortable: boolean
  sortField?: SortableField
  widthHint?: number
  pinLeft?: boolean
  render?: RenderIntent
  renderCell?: (value: unknown, row: Row) => ReactNode
}

/** Returns '—' for null/undefined, otherwise String(value). */
export function formatNullable(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return String(value)
}

interface CellProps<Row> {
  column: DataTableColumn<Row>
  value: unknown
  row: Row
}

export function Cell<Row>({ column, value, row }: CellProps<Row>) {
  if (column.renderCell !== undefined) {
    return <>{column.renderCell(value, row)}</>
  }

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground select-none">—</span>
  }

  switch (column.render) {
    case 'metric':
      return <MetricCell value={value as number} />

    case 'inversion':
      return <InversionFlag inversion={value as boolean} />

    case 'cann-type':
      return <CannTypeTag type={value as CannType} />

    case 'status': {
      const state = value as { status: GroupStatus; notes: string | null }
      return <StatusPill status={state.status} />
    }

    case 'action':
      return <ActionTag action={value as RecommendedAction} />

    default:
      return <span>{String(value)}</span>
  }
}
