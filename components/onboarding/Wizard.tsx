'use client'

import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'
import { derivePropertyType } from '@/src/contracts/lib/gsc-property'

type Step = 1 | 2 | 3

// Mirrors GscSite in server/ingest/gsc-client.ts; redeclared here so the client
// bundle does not import server-only code.
interface GscSite {
  siteUrl: string
  permissionLevel: string
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 rounded-full transition-all ${
            i + 1 === current
              ? 'w-6 bg-primary'
              : i + 1 < current
                ? 'w-2 bg-primary/50'
                : 'w-2 bg-muted'
          }`}
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">Passo {current} di {total}</span>
    </div>
  )
}

function FieldRow({ id, label, children }: { id?: string; label: string; children: ReactElement }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

export function Wizard(): ReactElement {
  const router = useRouter()
  const [step, setStep]               = useState<Step>(1)
  const [name, setName]               = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [pending, setPending]         = useState(false)
  const [gscMsg, setGscMsg]           = useState<string | null>(null)
  const [createdId, setCreatedId]     = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  // Step 3 — property picker
  const [sites, setSites]             = useState<GscSite[] | null>(null)
  const [sitesError, setSitesError]   = useState<string | null>(null)
  const [selectedSite, setSelectedSite] = useState('')
  const [saving, setSaving]           = useState(false)

  async function loadSites(projectId: string) {
    setSites(null)
    setSitesError(null)
    const res = await apiClient<{ sites: GscSite[] }>(`/api/projects/${projectId}/gsc/sites`)
    if (res.error !== null) {
      setSitesError(res.error.message)
      return
    }
    setSites(res.data.sites)
    if (res.data.sites[0] !== undefined) setSelectedSite(res.data.sites[0].siteUrl)
  }

  // Resume after the OAuth round-trip. The callback redirects back to
  // /onboarding?projectId=…&gsc=connected (or gsc=error&reason=…). State updates
  // are deferred out of the effect's synchronous phase (see ThemeToggle).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('projectId')
    const gsc = params.get('gsc')
    if (projectId === null || gsc === null) return

    void Promise.resolve().then(() => {
      setCreatedId(projectId)
      if (gsc === 'connected') {
        setStep(3)
        void loadSites(projectId)
      } else {
        setStep(2)
        setGscMsg(`Connessione non riuscita${params.get('reason') !== null ? ` (${params.get('reason')})` : ''}.`)
      }
    })
  }, [])

  async function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (name.trim().length === 0) return
    setError(null)
    setPending(true)
    const res = await apiClient<ProjectDTO>('/api/projects', {
      method: 'POST',
      body:   JSON.stringify({ name: name.trim() }),
    })
    setPending(false)
    if (res.error !== null) {
      setError(res.error.message)
      return
    }
    setCreatedId(res.data.id)
    setStep(2)
  }

  async function handleConnectGsc() {
    if (createdId === null) return
    setGscMsg(null)
    setIsConnecting(true)
    try {
      const res = await apiClient<{ url: string }>(`/api/projects/${createdId}/gsc/auth-url?flow=onboarding`)
      if (res.error !== null) {
        setGscMsg(res.error.message)
        setIsConnecting(false)
        return
      }
      window.location.href = res.data.url
    } catch (err) {
      setGscMsg(err instanceof Error ? err.message : 'Errore di rete')
      setIsConnecting(false)
    }
  }

  async function handleSaveProperty() {
    if (createdId === null || selectedSite === '') return
    setSitesError(null)
    setSaving(true)
    const res = await apiClient<ProjectDTO>(`/api/projects/${createdId}`, {
      method: 'PATCH',
      body:   JSON.stringify({
        gscProperty:  selectedSite,
        propertyType: derivePropertyType(selectedSite),
        status:       'active',
      }),
    })
    if (res.error !== null) {
      setSaving(false)
      setSitesError(res.error.message)
      return
    }
    router.push(`/p/${createdId}/overview`)
  }

  const inputCls = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const btnPrimary = 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
  const btnSecondary = 'rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent'

  return (
    <div className="rounded-lg border border-border bg-card p-8">
      <StepIndicator current={step} total={3} />

      {step === 1 && (
        <form onSubmit={handleStep1} className="flex flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold">Crea il tuo progetto</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Dai un nome al progetto per identificarlo nella dashboard.
            </p>
          </div>
          <FieldRow id="name" label="Nome progetto">
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="es. Sito aziendale"
              className={inputCls}
            />
          </FieldRow>
          {error !== null && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={pending || name.trim().length === 0} className={btnPrimary}>
              {pending ? 'Creazione…' : 'Avanti →'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold">Connetti Google Search Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Autorizza l&apos;accesso a GSC: al passo successivo sceglierai la proprietà da analizzare.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => { void handleConnectGsc() }}
              disabled={isConnecting}
              aria-busy={isConnecting}
              aria-label={isConnecting ? 'Connessione in corso' : 'Connetti a Google Search Console'}
              className={`${btnSecondary} inline-flex items-center gap-2 disabled:opacity-50`}
            >
              {isConnecting && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {isConnecting ? 'Connessione…' : 'Connetti a Google Search Console'}
            </button>
            {gscMsg !== null && (
              <p className="text-sm text-muted-foreground" role="alert">{gscMsg}</p>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold">Scegli la proprietà GSC</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Seleziona la proprietà da cui importare i dati di Search Console.
            </p>
          </div>

          {sites === null && sitesError === null && (
            <p className="text-sm text-muted-foreground">Caricamento proprietà…</p>
          )}

          {sites !== null && sites.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessuna proprietà trovata per questo account Google.
            </p>
          )}

          {sites !== null && sites.length > 0 && (
            <FieldRow id="gscSite" label="Proprietà">
              <select
                id="gscSite"
                value={selectedSite}
                onChange={e => setSelectedSite(e.target.value)}
                className={inputCls}
              >
                {sites.map(s => (
                  <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                ))}
              </select>
            </FieldRow>
          )}

          {sitesError !== null && <p className="text-sm text-destructive" role="alert">{sitesError}</p>}

          <div className="flex justify-between border-t border-border pt-4">
            <button
              type="button"
              onClick={() => { setStep(2); setGscMsg(null); setSitesError(null) }}
              className={btnSecondary}
            >
              ← Indietro
            </button>
            <button
              type="button"
              onClick={() => { void handleSaveProperty() }}
              disabled={saving || selectedSite === ''}
              className={btnPrimary}
            >
              {saving ? 'Salvataggio…' : 'Salva e continua →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
