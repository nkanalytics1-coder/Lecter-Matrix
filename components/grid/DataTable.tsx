'use client'

import { useState, useCallback } from 'react'
import { parseAsString, useQueryState } from 'nuqs'
import type { SortableField, SortDir, SortParam } from '@/src/contracts/ui/props'
import { Cell } from './Cell'
import type { DataTableColumn } from './Cell'

export const DEFAULT_SORT: SortParam = 'severity:desc'

/** Pure: compute the next sort string after clicking a column header. */
export function computeNextSort(
  field: SortableField,
  currentSort: string,
): SortParam {
  const [curField, curDir] = currentSort.split(':')
  if (curField !== field) return `${field}:desc` as SortParam
  if (curDir === 'desc') return `${field}:asc` as SortParam
  return DEFAULT_SORT
}

/** Pure: aria-sort value for a column header. */
export function getAriaSort(
  sortField: SortableField | undefined,
  sortable: boolean,
  currentSort: string,
): 'ascending' | 'descending' | 'none' {
  if (!sortable || sortField === undefined) return 'none'
  const [field, dir] = currentSort.split(':')
  if (field !== sortField) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
}

interface DataTableProps<Row extends object> {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  onLoadMore: () => void
  hasMore: boolean
}

export default function DataTable<Row extends object>({
  columns,
  rows,
  onLoadMore,
  hasMore,
}: DataTableProps<Row>) {
  const [sort, setSort] = useQueryState(
    'sort',
    parseAsString.withDefault(DEFAULT_SORT),
  )
  const [focusedCell, setFocusedCell] = useState<[number, number]>([0, 0])

  const handleHeaderClick = useCallback(
    (col: DataTableColumn<Row>) => {
      if (!col.sortable || col.sortField === undefined) return
      void setSort(computeNextSort(col.sortField, sort))
    },
    [sort, setSort],
  )

  const handleHeaderKeyDown = useCallback(
    (e: React.KeyboardEvent, col: DataTableColumn<Row>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleHeaderClick(col)
      }
    },
    [handleHeaderClick],
  )

  const moveFocus = useCallback(
    (rowIdx: number, colIdx: number) => {
      const next: [number, number] = [
        Math.max(0, Math.min(rowIdx, rows.length - 1)),
        Math.max(0, Math.min(colIdx, columns.length - 1)),
      ]
      setFocusedCell(next)
      document.getElementById(`dtcell-${next[0]}-${next[1]}`)?.focus()
    },
    [rows.length, columns.length],
  )

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          moveFocus(rowIdx + 1, colIdx)
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus(rowIdx - 1, colIdx)
          break
        case 'ArrowRight':
          e.preventDefault()
          moveFocus(rowIdx, colIdx + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          moveFocus(rowIdx, colIdx - 1)
          break
      }
    },
    [moveFocus],
  )

  const pinnedWidth = columns.find((c) => c.pinLeft)?.widthHint ?? 0

  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label="Gruppi di cannibalizzazione"
        className="w-max min-w-full text-sm"
      >
        {/* Header */}
        <div role="row" className="flex border-b border-border bg-accent">
          {columns.map((col) => {
            const ariaSort = getAriaSort(col.sortField, col.sortable, sort)
            return (
              <div
                key={col.id}
                role="columnheader"
                aria-sort={col.sortable ? ariaSort : undefined}
                style={{ width: col.widthHint ?? 120, minWidth: col.widthHint ?? 120 }}
                className={[
                  'flex items-center gap-1 px-3 py-2 text-xs font-semibold text-muted-foreground select-none',
                  col.pinLeft
                    ? 'sticky left-0 z-10 bg-accent'
                    : '',
                  col.sortable
                    ? 'cursor-pointer hover:text-foreground'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={col.sortable ? 0 : -1}
                onClick={() => handleHeaderClick(col)}
                onKeyDown={(e) => handleHeaderKeyDown(e, col)}
              >
                {col.header}
                {col.sortable && ariaSort !== 'none' && (
                  <span aria-hidden="true" className="text-foreground">
                    {ariaSort === 'ascending' ? '↑' : '↓'}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Rows */}
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            role="row"
            className="flex border-b border-border hover:bg-accent/50"
          >
            {columns.map((col, colIdx) => {
              const value: unknown = (row as Record<string, unknown>)[col.accessor]
              const isFocused =
                focusedCell[0] === rowIdx && focusedCell[1] === colIdx
              return (
                <div
                  key={col.id}
                  id={`dtcell-${rowIdx}-${colIdx}`}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                  style={{ width: col.widthHint ?? 120, minWidth: col.widthHint ?? 120 }}
                  className={[
                    'flex items-center px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-border',
                    col.pinLeft
                      ? 'sticky left-0 z-10 bg-background'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onFocus={() => setFocusedCell([rowIdx, colIdx])}
                  onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                >
                  <Cell column={col} value={value} row={row} />
                </div>
              )
            })}
          </div>
        ))}

        {/* Load more */}
        <div role="row">
          <div
            role="gridcell"
            aria-colSpan={columns.length}
            className="px-3 py-3"
            style={{ marginLeft: pinnedWidth }}
          >
            <button
              type="button"
              onClick={onLoadMore}
              disabled={!hasMore}
              className="rounded px-4 py-1.5 text-sm font-medium bg-accent text-accent-foreground hover:bg-border disabled:cursor-not-allowed disabled:opacity-40"
            >
              Carica altri
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
