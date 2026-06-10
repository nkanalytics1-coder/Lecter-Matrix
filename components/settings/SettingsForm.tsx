'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'
import { ProjectConfigSchema } from '@/src/contracts/schemas/project-config'
import { SyncStatusPill } from '@/components/shell/SyncStatusPill'

interface Props {
  projectId: string
  initialData: ProjectDTO
}

function FieldError({ msg }: { msg?: string }) {
  if (msg === undefined) return null
  return <p className="mt-1 text-xs text-destructive" role="alert">{msg}</p>
}

function TextInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  )
}

export function SettingsForm({ projectId, initialData }: Props) {
  const qc     = useQueryClient()
  const router = useRouter()

  const [name, setName]         = useState(initialData.name)
  const [timezone, setTimezone] = useState(initialData.timezone)
  const [status, setStatus]     = useState<'active' | 'paused'>(
    initialData.status === 'active' || initialData.status === 'paused' ? initialData.status : 'active',
  )

  const [cfg, setCfg] = useState({
    intentSignals: '', brandTerms: '',
    minMembers: '', maxMembers: '',
    minGroupImpr: '', minMemberImpr: '',
    slugJaccard: '',
  })

  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [saved, setSaved]       = useState(false)
  const [gscMsg, setGscMsg]           = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [deleteMsg, setDeleteMsg]     = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient<ProjectDTO>(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body:   JSON.stringify(body),
      }),
    onSuccess: (result) => {
      if (result.error !== null) {
        setErrors({ _form: result.error.message })
        setSaved(false)
      } else {
        setErrors({})
        setSaved(true)
        void qc.invalidateQueries({ queryKey: ['project', projectId] })
      }
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    const toList = (s: string) => s.trim() ? s.split('\n').map(x => x.trim()).filter(Boolean) : undefined
    const toNum  = (s: string) => s !== '' ? Number(s) : undefined

    const rawCfg = {
      intent_signals_extra:     toList(cfg.intentSignals),
      brand_terms:              toList(cfg.brandTerms),
      min_members:              toNum(cfg.minMembers),
      min_group_impressions:    toNum(cfg.minGroupImpr),
      min_member_impressions:   toNum(cfg.minMemberImpr),
      max_members:              toNum(cfg.maxMembers),
      slug_jaccard_consolidate: toNum(cfg.slugJaccard),
    }

    const cfgResult = ProjectConfigSchema.safeParse(rawCfg)
    if (!cfgResult.success) {
      const errs: Record<string, string> = {}
      for (const issue of cfgResult.error.issues) {
        errs[issue.path.join('.') || '_cfg'] = issue.message
      }
      setErrors(errs)
      return
    }

    const config: Record<string, unknown> = Object.fromEntries(
      (Object.entries(cfgResult.data) as [string, unknown][]).filter(([, v]) => v !== undefined),
    )
    mutation.mutate({ name, timezone, status, config })
  }

  async function handleReconnect() {
    setGscMsg(null)
    setIsReconnecting(true)
    try {
      const res = await apiClient<{ url: string }>(`/api/projects/${projectId}/gsc/auth-url`)
      if (res.error !== null) {
        setGscMsg(res.error.message)
        setIsReconnecting(false)
        return
      }
      window.location.href = res.data.url
    } catch (err) {
      setGscMsg(err instanceof Error ? err.message : 'Errore di rete')
      setIsReconnecting(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Sei sicuro? L\'azione è irreversibile.')) return
    setDeleteMsg(null)
    try {
      const res = await apiClient<unknown>(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (res.error !== null) {
        setDeleteMsg(res.error.message)
        return
      }
      router.push('/')
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : 'Errore di rete')
    }
  }

  const set = (field: keyof typeof cfg) => (v: string) => setCfg(prev => ({ ...prev, [field]: v }))

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-8">

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informazioni generali</h2>
        <TextInput id="name"     label="Nome progetto" value={name}     onChange={setName} />
        <FieldError msg={errors['name']} />
        <TextInput id="timezone" label="Fuso orario"   value={timezone} onChange={setTimezone} />
        <FieldError msg={errors['timezone']} />

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Stato</span>
          <div className="flex gap-4">
            {(['active', 'paused'] as const).map(s => (
              <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                {s === 'active' ? 'Attivo' : 'In pausa'}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Proprietà GSC</span>
          <span className="text-sm font-medium">{initialData.gscProperty}</span>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configurazione rilevamento</h2>

        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ['minMembers',   'Min. membri',              'min_members',              'default 2'],
              ['maxMembers',   'Max. membri',              'max_members',              'default 6'],
              ['minGroupImpr', 'Min. impr. gruppo',        'min_group_impressions',    'default 100'],
              ['minMemberImpr','Min. impr. membro',        'min_member_impressions',   'default 10'],
              ['slugJaccard',  'Soglia Jaccard slug',      'slug_jaccard_consolidate', '0–1'],
            ] as const
          ).map(([key, label, field, hint]) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={key} className="text-sm font-medium">{label}</label>
              <input id={key} type="number" value={cfg[key]} placeholder={hint} onChange={e => set(key)(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <FieldError msg={errors[field]} />
            </div>
          ))}
        </div>

        {(['intentSignals', 'brandTerms'] as const).map((key) => {
          const isIntent = key === 'intentSignals'
          const field    = isIntent ? 'intent_signals_extra' : 'brand_terms'
          const label    = isIntent ? 'Segnali intento extra' : 'Termini brand'
          const hint     = isIntent ? 'es: comprare, acquistare' : 'es: nomebrand, variante'
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={key} className="text-sm font-medium">
                {label} <span className="font-normal text-muted-foreground">(uno per riga)</span>
              </label>
              <textarea id={key} rows={3} value={cfg[key]} placeholder={hint} onChange={e => set(key)(e.target.value)}
                className="resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <FieldError msg={errors[field]} />
            </div>
          )
        })}
      </section>

      {errors['_form'] !== undefined && <p className="text-sm text-destructive">{errors['_form']}</p>}
      {saved && <p className="text-sm text-green-700 dark:text-green-400">Impostazioni salvate.</p>}

      <button type="submit" disabled={mutation.isPending}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {mutation.isPending ? 'Salvataggio…' : 'Salva impostazioni'}
      </button>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connessione GSC</h2>
        <div className="flex items-center gap-3">
          <SyncStatusPill status={initialData.connection?.status ?? null} />
          <button type="button" onClick={() => void handleReconnect()}
            disabled={isReconnecting}
            aria-busy={isReconnecting}
            aria-label={isReconnecting ? 'Connessione in corso' : 'Riconnetti GSC'}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            {isReconnecting && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
            {isReconnecting ? 'Connessione…' : 'Riconnetti'}
          </button>
        </div>
        {gscMsg !== null && <p className="text-sm text-muted-foreground">{gscMsg}</p>}
      </section>

      <section className="flex flex-col gap-3 border-t border-destructive/30 pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">Zona pericolosa</h2>
        <button type="button" onClick={() => void handleDelete()}
          className="self-start rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">
          Elimina progetto
        </button>
        {deleteMsg !== null && <p className="text-sm text-destructive">{deleteMsg}</p>}
      </section>
    </form>
  )
}
