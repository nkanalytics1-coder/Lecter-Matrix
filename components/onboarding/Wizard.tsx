'use client'

import { useState, type FormEvent, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import type { ProjectDTO } from '@/src/contracts/types/entities'
import { PropertyType } from '@/src/contracts/types/domain'

type Step = 1 | 2 | 3

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
  const [gscProperty, setGscProperty] = useState('')
  const [propertyType, setPropertyType] = useState<typeof PropertyType[number]>('domain')
  const [error, setError]             = useState<string | null>(null)
  const [pending, setPending]         = useState(false)
  const [gscMsg, setGscMsg]           = useState<string | null>(null)
  const [createdId, setCreatedId]     = useState<string | null>(null)

  function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (name.trim().length === 0) return
    setStep(2)
  }

  async function handleStep2(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (gscProperty.trim().length === 0) return
    setError(null)
    setPending(true)
    const res = await apiClient<ProjectDTO>('/api/projects', {
      method: 'POST',
      body:   JSON.stringify({ name: name.trim(), gscProperty: gscProperty.trim(), propertyType }),
    })
    setPending(false)
    if (res.error !== null) {
      setError(res.error.message)
      return
    }
    setCreatedId(res.data.id)
    setStep(3)
  }

  async function handleConnectGsc() {
    if (createdId === null) return
    setGscMsg(null)
    try {
      const res = await apiClient<{ url: string }>(`/api/projects/${createdId}/gsc/auth-url`)
      if (res.error !== null) {
        setGscMsg(res.error.message)
        return
      }
      window.location.href = res.data.url
    } catch (err) {
      setGscMsg(err instanceof Error ? err.message : 'Errore di rete')
    }
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
          <div className="flex justify-end">
            <button type="submit" disabled={name.trim().length === 0} className={btnPrimary}>
              Avanti →
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2} className="flex flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold">Proprietà Google Search Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Indica la proprietà GSC da cui verranno importati i dati.
            </p>
          </div>
          <FieldRow id="gscProperty" label="URL proprietà">
            <input
              id="gscProperty"
              type="text"
              required
              value={gscProperty}
              onChange={e => setGscProperty(e.target.value)}
              placeholder="es. https://www.esempio.it/ oppure sc-domain:esempio.it"
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Tipo proprietà">
            <div className="flex gap-4">
              {PropertyType.map(t => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="propertyType"
                    value={t}
                    checked={propertyType === t}
                    onChange={() => setPropertyType(t)}
                  />
                  {t === 'domain' ? 'Dominio' : 'Prefisso URL'}
                </label>
              ))}
            </div>
          </FieldRow>
          {error !== null && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-between">
            <button type="button" onClick={() => { setStep(1); setError(null) }} className={btnSecondary}>
              ← Indietro
            </button>
            <button type="submit" disabled={pending || gscProperty.trim().length === 0} className={btnPrimary}>
              {pending ? 'Creazione…' : 'Avanti →'}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold">Connetti Google Search Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Autorizza l'accesso ai dati GSC per avviare la prima sincronizzazione.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => { void handleConnectGsc() }}
              className={btnSecondary}
            >
              Connetti a Google Search Console
            </button>
            {gscMsg !== null && (
              <p className="text-sm text-muted-foreground">{gscMsg}</p>
            )}
          </div>
          <div className="flex justify-between border-t border-border pt-4">
            <button
              type="button"
              onClick={() => { setStep(2); setGscMsg(null) }}
              className={btnSecondary}
            >
              ← Indietro
            </button>
            <button
              type="button"
              onClick={() => {
                if (createdId !== null) {
                  router.push(`/p/${createdId}/overview`)
                }
              }}
              disabled={createdId === null}
              className={btnPrimary}
            >
              Vai al progetto →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
