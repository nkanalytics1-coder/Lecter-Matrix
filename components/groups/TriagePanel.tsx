'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CannibalizationGroupDTO } from '@/src/contracts/types/entities'
import type { GroupStatus } from '@/src/contracts/types/domain'
import { apiClient } from '@/lib/api-client'

interface StateResponse {
  groupKey:  string
  status:    GroupStatus
  notes:     string | null
  updatedAt: string
}

interface Props {
  groupId:   number
  state:     { status: GroupStatus; notes: string | null } | null
  updatedAt: string
}

const STATUS_OPTIONS: { value: GroupStatus; label: string }[] = [
  { value: 'open',        label: 'Aperto' },
  { value: 'in_progress', label: 'In corso' },
  { value: 'resolved',    label: 'Risolto' },
  { value: 'ignored',     label: 'Ignorato' },
]

const DATE_FMT = new Intl.DateTimeFormat('it-IT', {
  day:    '2-digit',
  month:  '2-digit',
  year:   'numeric',
  hour:   '2-digit',
  minute: '2-digit',
})

export function TriagePanel({ groupId, state, updatedAt }: Props) {
  const queryClient = useQueryClient()
  const QUERY_KEY   = ['group', groupId] as const

  const currentStatus = state?.status ?? 'open'
  const currentNotes  = state?.notes  ?? ''

  const [localNotes,  setLocalNotes]  = useState(currentNotes)
  const [triageTs,    setTriageTs]    = useState<string | null>(null)

  const notesChanged = localNotes !== currentNotes

  const mutation = useMutation({
    mutationFn: async (patch: { status?: GroupStatus; notes?: string | null }) => {
      const result = await apiClient<StateResponse>(
        `/api/groups/${groupId}/state`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      )
      if (result.error) throw new Error(result.error.message)
      return result.data
    },

    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<CannibalizationGroupDTO>(QUERY_KEY)
      queryClient.setQueryData<CannibalizationGroupDTO>(QUERY_KEY, (old) => {
        if (old === undefined) return old
        return {
          ...old,
          state: {
            status: patch.status ?? old.state?.status ?? 'open',
            notes:  patch.notes !== undefined ? patch.notes : (old.state?.notes ?? null),
          },
        }
      })
      return { previous }
    },

    onError: (_err, _patch, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(QUERY_KEY, ctx.previous)
      }
    },

    onSuccess: (data) => {
      queryClient.setQueryData<CannibalizationGroupDTO>(QUERY_KEY, (old) => {
        if (old === undefined) return old
        return {
          ...old,
          state: { status: data.status, notes: data.notes },
        }
      })
      setLocalNotes(data.notes ?? '')
      setTriageTs(data.updatedAt)
    },
  })

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as GroupStatus
    mutation.mutate({ status: next })
  }

  function handleSaveNotes() {
    mutation.mutate({ notes: localNotes === '' ? null : localNotes })
  }

  const displayTs = triageTs ?? (state !== null ? updatedAt : null)

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Triage
      </h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="triage-status" className="text-sm font-medium">
          Stato
        </label>
        <select
          id="triage-status"
          value={currentStatus}
          onChange={handleStatusChange}
          disabled={mutation.isPending}
          className="w-48 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          {STATUS_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="triage-notes" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="triage-notes"
          value={localNotes}
          onChange={(e) => { setLocalNotes(e.target.value) }}
          disabled={mutation.isPending}
          rows={3}
          placeholder="Aggiungi note sul gruppo…"
          className="rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={!notesChanged || mutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Salva note
          </button>
          {mutation.isError && (
            <p className="text-xs text-destructive" role="alert">
              Errore nel salvataggio. Riprova.
            </p>
          )}
        </div>
      </div>

      {displayTs !== null && (
        <p className="text-xs text-muted-foreground">
          Ultimo aggiornamento triage:{' '}
          {DATE_FMT.format(new Date(displayTs))}
        </p>
      )}
    </section>
  )
}
