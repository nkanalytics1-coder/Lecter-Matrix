'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'
import type { Paginated } from '@/src/contracts/types/api'
import type { GroupFilter } from '@/src/contracts/ui/props'
import { groupListQueryParsers } from '@/lib/search-params'
import { apiClient } from '@/lib/api-client'
import { FilterBar } from '@/components/filters/FilterBar'
import DataTable from '@/components/grid/DataTable'
import { groupTableColumns } from '@/components/grid/columns.groups'

interface Props {
  projectId: string
  initialData: Paginated<CannibalizationGroupDTO>
}

export function GroupTable({ projectId, initialData }: Props) {
  const router = useRouter()
  const [params, setParams] = useQueryStates(groupListQueryParsers)
  const [allRows, setAllRows] = useState<CannibalizationGroupDTO[]>(initialData.items)
  const [nextCursorState, setNextCursorState] = useState<string | null>(
    initialData.nextCursor,
  )

  // Refs to avoid stale closure issues in effects
  const sortRef    = useRef(params.sort)
  const cursorRef  = useRef(params.cursor)
  const lastDataRef = useRef<Paginated<CannibalizationGroupDTO> | undefined>(undefined)

  useEffect(() => {
    cursorRef.current = params.cursor
  }, [params.cursor])

  // Detect sort changes from DataTable's internal sort toggle and reset cursor
  useEffect(() => {
    if (params.sort === sortRef.current) return
    sortRef.current = params.sort
    void setParams({ cursor: null })
  }, [params.sort, setParams])

  const { data, isFetching, isError } = useQuery({
    queryKey: ['groups', projectId, params],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams()
      if (params.severityBand?.length) qs.set('severityBand', params.severityBand.join(','))
      if (params.severityMin != null) qs.set('severityMin', String(params.severityMin))
      if (params.cannType?.length) qs.set('cannType', params.cannType.join(','))
      if (params.intent?.length) qs.set('intent', params.intent.join(','))
      if (params.status?.length) qs.set('status', params.status.join(','))
      if (params.pathPrefix) qs.set('pathPrefix', params.pathPrefix)
      if (params.inversionOnly) qs.set('inversionOnly', 'true')
      if (params.hideBenign) qs.set('hideBenign', 'true')
      if (params.q) qs.set('q', params.q)
      if (params.cursor) qs.set('cursor', params.cursor)
      qs.set('sort', params.sort)
      qs.set('limit', String(params.limit))
      const result = await apiClient<Paginated<CannibalizationGroupDTO>>(
        `/api/projects/${projectId}/groups?${qs.toString()}`,
        { signal },
      )
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    initialData,
    staleTime: 30_000,
  })

  // Replace rows on cursor=null (filter/sort reset); append on load-more
  useEffect(() => {
    if (!data || data === lastDataRef.current) return
    lastDataRef.current = data
    if (cursorRef.current == null) {
      setAllRows(data.items)
    } else {
      setAllRows((prev) => [...prev, ...data.items])
    }
    setNextCursorState(data.nextCursor ?? null)
  }, [data])

  const handleFilterChange = useCallback(
    (newFilter: GroupFilter) => {
      void setParams({
        severityBand:  newFilter.severityBand ?? null,
        severityMin:   newFilter.severityMin ?? null,
        cannType:      newFilter.cannType ?? null,
        intent:        newFilter.intent ?? null,
        status:        newFilter.status ?? null,
        pathPrefix:    newFilter.pathPrefix ?? null,
        inversionOnly: newFilter.inversionOnly ?? null,
        hideBenign:    newFilter.hideBenign ?? null,
        q:             newFilter.q ?? null,
        cursor:        null,
      })
    },
    [setParams],
  )

  const handleLoadMore = useCallback(() => {
    if (nextCursorState) void setParams({ cursor: nextCursorState })
  }, [nextCursorState, setParams])

  const filter: GroupFilter = {}
  if (params.severityBand !== null)  filter.severityBand  = params.severityBand
  if (params.severityMin !== null)   filter.severityMin   = params.severityMin
  if (params.cannType !== null)      filter.cannType      = params.cannType
  if (params.intent !== null)        filter.intent        = params.intent
  if (params.status !== null)        filter.status        = params.status
  if (params.pathPrefix !== null)    filter.pathPrefix    = params.pathPrefix
  if (params.inversionOnly !== null) filter.inversionOnly = params.inversionOnly
  if (params.hideBenign !== null)    filter.hideBenign    = params.hideBenign
  if (params.q !== null)             filter.q             = params.q

  return (
    <div className="flex flex-col gap-4">
      <FilterBar filter={filter} onChange={handleFilterChange} />

      {isError && (
        <p className="text-sm text-destructive" role="alert">
          Errore nel caricamento dei gruppi. Riprova.
        </p>
      )}

      {isFetching && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Aggiornamento…
        </p>
      )}

      <DataTable
        columns={groupTableColumns}
        rows={allRows}
        onLoadMore={handleLoadMore}
        hasMore={nextCursorState !== null}
        onRowClick={(row) => router.push(`/p/${projectId}/groups/${row.groupKey}`)}
      />
    </div>
  )
}
